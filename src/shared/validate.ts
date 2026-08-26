// Validation partagee entre le broker et le CLI. Le label choisi par
// l'appelant finit dans un nom de fichier (screenshot) et comme cle de map ;
// sans restriction de charset, un label comme "../../../../Windows/whatever"
// permet une ecriture hors du dossier de captures prevu (path traversal).
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidLabel(label: unknown): label is string {
  return typeof label === 'string' && LABEL_PATTERN.test(label);
}
