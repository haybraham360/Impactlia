export const THEME_STORAGE_KEY = "impactlia-theme";

// Runs in <head> before first paint so a forced theme never flashes the
// system one. "System" is the absence of the attribute.
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})()`;
