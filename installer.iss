; Installeur Windows Hublot (Inno Setup), sur le meme modele que
; justmakeQ/installer.iss : un script declaratif plutot qu'une toolchain
; Rust/Tauri/NSIS a part. APP_VERSION vient du CI (release-windows.yml
; patche package.json puis exporte cette variable) ; en local sans elle,
; retombe sur un numero de dev pour pouvoir quand meme tester le build.
#define MyAppName      "Hublot"
#define MyAppPublisher "BREIZHZION"
#define MyAppURL       "https://hublot.breizhzion.com"
#define MyAppExeName   "hublot.exe"
#define MyAppVersion   GetEnv("APP_VERSION")
#if MyAppVersion == ""
  #define MyAppVersion "0.0.0-dev"
#endif

[Setup]
AppId={{3F1A9C2E-6B4D-4F8A-9E3C-1D2B5A7C8E4F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Hublot
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=LICENSE.md
OutputDir=build
OutputBaseFilename=hublot-{#MyAppVersion}-x64-setup
SetupIconFile=site\assets\favicon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Comme JustMakeQ : installation par utilisateur, pas besoin de droits admin
; (Hublot pilote un navigateur sous le compte de l'utilisateur courant, une
; installation systeme n'aurait aucun sens).
PrivilegesRequired=lowest
; "commandline" en plus de "dialog" : sans ca, /CURRENTUSER et /ALLUSERS
; sont ignores et l'installeur affiche quand meme la boite "Select Setup
; Install Mode" meme avec /VERYSILENT (constate en testant reellement une
; installation silencieuse, pas une supposition).
PrivilegesRequiredOverridesAllowed=dialog commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
MinVersion=10.0
; ⚠️ `force` et pas la valeur par defaut `yes`, et le detail compte : une mise a jour
; pendant que le broker tourne ECHOUAIT, en code 5, silencieusement.
;
; Mesure et non deduction, journal `/LOG` de l'installateur a l'appui :
;   RestartManager found an application using one of our files: Hublot
;   Shutting down applications using our files.
;   Defaulting to Abort for suppressed message box (Abort/Retry/Ignore):
;   User canceled the installation process.
;
; `CloseApplications` vaut deja `yes` par defaut, donc rien ne manquait : Restart Manager
; trouvait bien le broker et lui demandait de s'arreter. Mais `yes` demande une fermeture
; PROPRE, et un processus Node qui tient un serveur ouvert ne s'arrete pas sur cette
; demande. Le fichier restait verrouille, Inno tombait sur une boite
; Abandonner/Reessayer/Ignorer, et `/SUPPRESSMSGBOXES` y repond Abandonner. D'ou un echec
; qui se lit comme un installateur casse.
;
; Le meme test sur NoiseCrypt passe en code 0 : son binaire Go se termine quand on le lui
; demande. Le discriminant n'est donc ni le type d'application (Restart Manager classe les
; deux en console, non redemarrables) ni Chromium, qui ne tient aucun fichier du
; repertoire d'installation. C'est uniquement que le processus coopere ou non.
;
; Le risque du mode `force`, que la documentation d'Inno signale, est la perte de travail
; non enregistre. Ici le processus force est un broker de navigateur : ses sessions sont
; perdues de toute facon par une mise a jour, et une mise a jour qui echoue en silence est
; pire qu'une session fermee.
CloseApplications=force

[Languages]
Name: "french";  MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; playwright-core ne survit pas au bundling (voir scripts/package-sea.mjs) :
; le dossier node_modules doit toujours accompagner l'exe, jamais l'inverse.
Source: "build\hublot.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "addtopath"; Description: "Ajouter Hublot au PATH (recommandé, pour lancer ""hublot"" depuis n'importe quel terminal)"; GroupDescription: "Options"; Flags: checkedonce

[Icons]
; ⚠️ Ce raccourci manquait, et son absence etait un vrai defaut. Cette section ne
; contenait QUE l'entree de desinstallation ci-dessous, donc apres installation le seul
; « programme » que le systeme connaissait de Hublot etait son desinstalleur. C'est
; l'explication la plus plausible du `Validation-No-Executables` pose par le pipeline de
; winget sur la PR #430896 : il enumere les points d'entree apres installation et n'en
; trouvait aucun.
;
; `start` et pas l'executable nu : sans commande, `hublot` imprime son aide et rend un
; code non nul, donc un clic aurait ouvert une console pour la refermer aussitot. `start`
; est le premier geste documente, il est idempotent, et il ouvre le Chromium visible qui
; est la raison d'etre de l'outil.
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "start"; Comment: "Démarrer le navigateur partagé Hublot"
Name: "{group}\Désinstaller {#MyAppName}"; Filename: "{uninstallexe}"

[Code]
const
  EnvironmentKey = 'Environment';

// Hublot est un CLI, pas une appli a double-cliquer : l'important n'est pas
// une icone bureau mais que "hublot" soit trouvable depuis n'importe quel
// terminal juste apres l'installation, meme raison d'etre que pour git/curl.
procedure EnvAddPath(Dir: string);
var
  Paths: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths) then
    Paths := '';
  if Paths = '' then
    Paths := Dir
  else if Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Paths) + ';') = 0 then
    Paths := Paths + ';' + Dir;
  RegWriteStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths);
end;

procedure EnvRemovePath(Dir: string);
var
  Paths: string;
  P: Integer;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths) then
    exit;
  P := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Paths) + ';');
  if P = 0 then
    exit;
  Delete(Paths, P - 1, Length(Dir) + 1);
  RegWriteStringValue(HKEY_CURRENT_USER, EnvironmentKey, 'Path', Paths);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('addtopath') then
    EnvAddPath(ExpandConstant('{app}'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    EnvRemovePath(ExpandConstant('{app}'));
end;
