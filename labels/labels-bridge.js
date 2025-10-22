(function () {
  function notify(id) {
    if (!id) return;
    // preferred hint for labels.js resolver
    window.__labelsCurrentScene = id;
    // keep existing hint for any legacy code
    window.__mapuiCurrentScene  = id;
    // fire event that labels.js listens to
    try {
      window.dispatchEvent(new CustomEvent('labels:scene', { detail: id }));
      if (typeof window.__notifySceneChange === 'function') {
        window.__notifySceneChange(id); // optional fast path
      }
    } catch (_) {}
  }

  // wrap switchToScene(id)
  if (typeof window.switchToScene === 'function') {
    var _origSwitchToScene = window.switchToScene;
    window.switchToScene = function (id) {
      var rv = _origSwitchToScene.apply(this, arguments);
      // notify now and once more after the transition
      notify(id);
      setTimeout(function(){ notify(id); }, 350);
      return rv;
    };
  }

  // wrap switchScene(sceneObj)
  if (typeof window.switchScene === 'function') {
    var _origSwitchScene = window.switchScene;
    window.switchScene = function (sceneObj) {
      var id = sceneObj && (sceneObj.id || (sceneObj.data && sceneObj.data.id));
      var rv = _origSwitchScene.apply(this, arguments);
      notify(id);
      setTimeout(function(){ notify(id); }, 350);
      return rv;
    };
  }

})();
