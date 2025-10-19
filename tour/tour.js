// ============================================================================
// Auto Tour System for Marzipano Virtual Tours
// Auto-hides UI when stopped and includes loop toggle
// ============================================================================

window.AutoTour = {
  active: false,
  scenes: [],
  current: 0,
  timer: null,
  loop: false,
  baseDelay: 6000,
  delay: 3000,
  stopping: false,
  progressEl: null,
  speedWrapEl: null,
  sliderEl: null,
  tourLabel: "Tour",

  // ------------------- Load tour JSON -------------------
  async load(tourName) {
    try {
      const res = await fetch(`tour/tours/${tourName}`);
      if (!res.ok) throw new Error(`Cannot load tour: ${tourName}`);
      const data = await res.json();

      this.tourLabel = tourName
        .replace(/\.json$/i, "")
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());

      if (Array.isArray(data.waypoints) && data.waypoints.length > 0) {
        this.scenes = data.waypoints.map(w => w.sceneId || w);
        this.baseDelay = data.duration || 6000;
        this.delay = this.baseDelay / 4;
        this.loop = data.loop ?? true;
      } else if (Array.isArray(data.scenes)) {
        this.scenes = data.scenes;
        this.baseDelay = data.duration || 6000;
        this.delay = this.baseDelay / 4;
        this.loop = data.loop ?? true;
      } else return false;

      this.ensureProgressPopup();
      this.ensureSpeedPanel();
      this.updateProgress(0);
      return true;
    } catch (err) {
      console.error("[Tour] Failed to load tour", err);
      return false;
    }
  },

  // ------------------- Start playback -------------------
  async start(tourName) {
    if (this.active) return;

    // ✅ Cleanly close MapUI and Info Popup without touching pins or map transforms
    try {
      const mapClose = document.getElementById("m4-close");
      if (mapClose) mapClose.click();
      else {
        const mapBackdrop = document.getElementById("m4-backdrop");
        if (mapBackdrop) {
          mapBackdrop.style.opacity = "0";
          setTimeout(() => (mapBackdrop.style.display = "none"), 300);
        }
      }

      const infoPopup = document.getElementById("m4-info-popup");
      if (infoPopup) {
        infoPopup.classList.remove("m4-open");
        infoPopup.style.display = "none";
      }
    } catch (e) {
      console.warn("[Tour] Popup close fallback", e);
    }

    // ✅ Keep pin layer stable — never hide or reset it
    const pinLayer = document.getElementById("m4-pinlayer");
    if (pinLayer) {
      pinLayer.style.display = "block";
      pinLayer.style.visibility = "visible";
      pinLayer.style.opacity = "1";
      pinLayer.style.transform = "none";
    }

    const ok = await this.load(tourName);
    if (!ok) return;

    this.active = true;
    this.current = 0;
    this.stopping = false;
    this.updateProgress(0);
    this.showUI(true);
    this.next();
  },

  // ------------------- Stop playback -------------------
  stop() {
    this.active = false;
    this.stopping = true;
    clearTimeout(this.timer);
    this.hideUI();

    // ✅ Keep pins visible after tour ends
    const pinLayer = document.getElementById("m4-pinlayer");
    if (pinLayer) {
      pinLayer.style.display = "block";
      pinLayer.style.visibility = "visible";
      pinLayer.style.opacity = "1";
    }
  },

  // ------------------- Advance to next scene -------------------
  next() {
    if (!this.active || this.stopping) return;
    const scene = this.scenes[this.current];
    const sceneId = typeof scene === "string" ? scene : scene?.sceneId;
    if (!sceneId) return;

    if (typeof window.safeSwitchToScene === "function") window.safeSwitchToScene(sceneId);
    if (typeof window.highlightActiveRow === "function") window.highlightActiveRow(sceneId);
    if (typeof window.highlightActivePin === "function") window.highlightActivePin(sceneId);

    this.updateProgress((this.current + 1) / this.scenes.length);

    this.current++;
    if (this.current >= this.scenes.length) {
      if (this.loop) this.current = 0;
      else return this.stop();
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), this.delay);
  },

  // ------------------- Progress Popup -------------------
  ensureProgressPopup() {
    if (this.progressEl) return;
    const el = document.createElement("div");
    el.id = "tour-progress";
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      padding: "8px 14px",
      background: "rgba(0,0,0,0.65)",
      color: "#fff",
      borderRadius: "10px",
      fontSize: "15px",
      fontWeight: "600",
      zIndex: "9999",
      pointerEvents: "none",
      transition: "opacity 0.3s ease",
      opacity: "0",
      whiteSpace: "nowrap"
    });
    document.body.appendChild(el);
    this.progressEl = el;
  },

  updateProgress(ratio) {
    if (!this.progressEl) return;
    const pct = Math.min(100, Math.round(ratio * 100));
    this.progressEl.textContent = `${this.tourLabel}: ${pct}%`;
    this.progressEl.style.opacity = "1";
  },

  // ------------------- Speed + Loop Panel -------------------
  ensureSpeedPanel() {
    if (this.speedWrapEl) return;

    const wrap = document.createElement("div");
    wrap.id = "tour-speed-wrap";
    Object.assign(wrap.style, {
      position: "fixed",
      top: "54px",
      left: "16px",
      background: "rgba(0,0,0,0.65)",
      padding: "10px 14px",
      borderRadius: "10px",
      color: "#fff",
      fontSize: "13px",
      zIndex: "9999",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      width: "150px",
      opacity: "1",
      transition: "opacity 0.4s ease"
    });

    const label = document.createElement("div");
    label.textContent = "Tour Speed";
    label.style.marginBottom = "4px";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.25";
    slider.max = "2";
    slider.step = "0.05";
    slider.value = "1";
    slider.classList.add("tour-speed-slider");
    slider.style.width = "100%";

    const valLbl = document.createElement("span");
    valLbl.textContent = "×1.00";
    valLbl.style.marginTop = "4px";

    const loopWrap = document.createElement("label");
    loopWrap.textContent = "Loop Tour";
    loopWrap.style.marginTop = "6px";
    loopWrap.style.display = "flex";
    loopWrap.style.alignItems = "center";
    loopWrap.style.gap = "6px";

    const loopBox = document.createElement("input");
    loopBox.type = "checkbox";
    loopBox.checked = this.loop;
    loopBox.addEventListener("change", () => {
      this.loop = loopBox.checked;
      console.log("[Tour] Loop set to", this.loop);
    });
    loopWrap.prepend(loopBox);

    slider.addEventListener("input", () => {
      const multiplier = parseFloat(slider.value);
      this.delay = (this.baseDelay / 4) / multiplier;
      valLbl.textContent = `×${multiplier.toFixed(2)}`;
      if (this.active && !this.stopping) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.next(), this.delay);
      }
    });

    wrap.append(label, slider, valLbl, loopWrap);
    document.body.appendChild(wrap);

    this.speedWrapEl = wrap;
    this.sliderEl = slider;
  },

  showUI(show = true) {
    if (this.progressEl) this.progressEl.style.opacity = show ? "1" : "0";
    if (this.speedWrapEl) this.speedWrapEl.style.opacity = show ? "1" : "0";
  },

  hideUI() {
    if (this.progressEl) this.progressEl.style.opacity = "0";
    if (this.speedWrapEl) this.speedWrapEl.style.opacity = "0";
  },
};

// ============================================================================
// Hook into Start Tour Button
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("m4-btn-auto");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const currentPin = window.currentPin || {};
    const tourFile = (currentPin.dataset?.tour || "birdsong.json").replace(/^\/+/, "");
    await window.AutoTour.start(tourFile);
  });
});

// ============================================================================
// Stop tour when user interacts (but ignore slider/loop area)
// ============================================================================
(function addStopListeners() {
  const stopOnInteract = (ev) => {
    if (ev.target.closest("#tour-speed-wrap")) return; // ignore inside control panel
    if (window.AutoTour.active && !window.AutoTour.stopping) {
      window.AutoTour.stop();
    }
  };
  ["mousedown", "wheel", "touchstart", "keydown"].forEach(evt =>
    window.addEventListener(evt, stopOnInteract, { passive: true })
  );
})();
