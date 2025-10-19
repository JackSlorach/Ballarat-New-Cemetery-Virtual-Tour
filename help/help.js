// Feature: Welcome Help Overlay waits for MapUI to open
window.addEventListener("DOMContentLoaded", () => {
  const overlay = document.createElement("div");
  overlay.id = "helpOverlay";
  overlay.innerHTML = `
    <div class="help-box">
      <h1>Welcome to the Ballarat Cemetery Map</h1>
      <p>Explore the cemetery in full 360° with interactive scenes and guided auto tours.</p>
      <p>
        • Click and drag to look around.<br>
        • Tap hotspots to view garden or section details.<br>
        • Use the menu to jump between areas.<br>
        • Look for the <b>“Auto Tour”</b> button inside popups to start a walkthrough.<br>
        • All scene controls are in the bottom-right grid menu.<br>
        • Ambient music volume: use the Music control to adjust volume.<br>
        • Use the Compass toggle to show/hide your facing direction.<br>
        • Floating labels display the name of the area you are looking at.<br>
        • Auto-rotate is off by default — use the Rotate control to start/stop it.
      </p>
      <span>Click or tap anywhere to begin</span>
    </div>
  `;
  document.body.appendChild(overlay);

  const hideOverlay = () => {
    overlay.classList.add("hidden");
    setTimeout(() => overlay.remove(), 600);
    document.removeEventListener("click", hideOverlay);
    document.removeEventListener("touchstart", hideOverlay);
  };

  // Wait for MapUI to initialize and open
  const waitForMapUI = setInterval(() => {
    const backdrop = document.getElementById("m4-backdrop");
    if (backdrop && backdrop.getAttribute("aria-hidden") === "false") {
      clearInterval(waitForMapUI);
      // Now allow the user to dismiss the overlay
      document.addEventListener("click", hideOverlay, { once: true });
      document.addEventListener("touchstart", hideOverlay, { once: true });
    }
  }, 300);

  // Fallback timeout (in case MapUI fails to load)
  setTimeout(() => {
    if (!document.getElementById("m4-backdrop")) {
      document.addEventListener("click", hideOverlay, { once: true });
      document.addEventListener("touchstart", hideOverlay, { once: true });
    }
  }, 8000);
});
