(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------------
   * Collapsible navigation (below the breakpoint)
   * ------------------------------------------------------------------- */
  const topbar = document.querySelector(".topbar");
  const navToggle = document.getElementById("nav-toggle");

  if (topbar && navToggle) {
    const setNavOpen = (open) => {
      topbar.classList.toggle("nav-open", open);
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    };

    navToggle.addEventListener("click", () => {
      setNavOpen(!topbar.classList.contains("nav-open"));
    });

    // Close again once a destination is picked: on mobile the menu covers the
    // content, so leaving it open would hide the section just reached.
    topbar.querySelectorAll(".topnav a").forEach((link) => {
      link.addEventListener("click", () => setNavOpen(false));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && topbar.classList.contains("nav-open")) {
        setNavOpen(false);
        navToggle.focus();
      }
    });

    document.addEventListener("click", (e) => {
      if (!topbar.classList.contains("nav-open")) return;
      if (!topbar.contains(e.target)) setNavOpen(false);
    });
  }

  /* ---------------------------------------------------------------------
   * Porthole readout: a fixed, purely decorative transcript of one agent
   * opening a tab and reading a page back. Never presented as a real
   * capture. Cut short if prefers-reduced-motion is set.
   * ------------------------------------------------------------------- */
  const readout = document.getElementById("porthole-typer");
  if (!readout) return;

  const transcript = [
    { text: "$ hublot open --label claude-main --url \"https://example.com\"\n" },
    { text: "opened claude-main (tab 1/3)\n\n" },
    { text: "$ hublot extract --label claude-main --selector \"h1\"\n" },
    { text: "Example Domain\n\n" },
    { text: "$ hublot screenshot --label claude-main\n" },
    { text: "C:\\Users\\pilot\\AppData\\Local\\Temp\\hublot-screenshots\\claude-main_1.png_" },
  ];

  function renderStatic() {
    readout.textContent = transcript.map((l) => l.text).join("");
  }

  if (reduceMotion) {
    renderStatic();
    return;
  }

  let lineIndex = 0;
  let charIndex = 0;
  let buffer = "";

  function typeNext() {
    if (lineIndex >= transcript.length) {
      readout.innerHTML = buffer.replace(/_$/, '<span class="caret"> </span>');
      return;
    }
    const current = transcript[lineIndex];
    if (charIndex < current.text.length) {
      buffer += current.text[charIndex];
      readout.textContent = buffer;
      charIndex++;
      window.setTimeout(typeNext, 20);
    } else {
      lineIndex++;
      charIndex = 0;
      window.setTimeout(typeNext, 260);
    }
  }

  // Only start once the porthole is actually visible, so the sequence isn't
  // "used up" before a visitor scrolls to it.
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        if (entries.some((e) => e.isIntersecting)) {
          typeNext();
          obs.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(readout);
  } else {
    typeNext();
  }
})();
