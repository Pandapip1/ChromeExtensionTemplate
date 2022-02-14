// Constants
const tracking_token = "MIXPANEL_TOKEN_HERE";
const install_url = "URL_TO_OPEN_ON_INSTALL";
const uninstall_url = "URL_TO_OPEN_ON_UNINSTALL";
const config_url = "URL_WITH_CONFIG";

// Useful functions
async function fetchTimeout(url, args = {}, timeout = 5000){
  let controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), timeout);
  return await fetch(url, Object.assign({ signal: controller.signal }, args));
}

async function track(event, props) {
  try {
    // Tracking token
    let token = tracking_token;
    // Generate random strings
    function genID(){
      let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let str = '';
      for (;str.length < 24;) str += characters.charAt(Math.random() * characters.length);
      return str;
    }
    // Generate user IDF
    let sync_data = await chrome.storage.sync.get(null);
    let user_id = sync_data.user_id;
    if (!user_id) {
      user_id = genID();
      await chrome.storage.sync.set({ user_id });
    }
    // Generate properties object
    let properties = Object.assign(Object.assign({}, props), {
      'time': Date.now() / 1000 | 0,
      'distinct_id': user_id,
      '$insert_id': genID(),
      'token': token
    });
    // Get if analytics are enabled
    let do_analytics = sync_data.options && sync_data.options.analytics;
    if (!do_analytics) {
      return;
    }
    // Send event
    return await fetchTimeout('https://api.mixpanel.com/track', {
      'method': 'POST',
      'headers': {
        'Accept': 'text/plain',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      'body': new URLSearchParams({
        'data': JSON.stringify({ event, properties }),
        'verbose': 1
      }, 2000)
    }).then(response => response.json());
  } catch { }
}

async function generateConfig(config) {
  let defaultConfig = await fetchTimeout(config_url);
  if (defaultConfig) {
    defaultConfig = defaultConfig.json();
    chrome.storage.local.set({ defaultConfig });
  } else {
    defaultConfig = (await chrome.storage.local.get(null)).defaultConfig;
  }
  return Object.assign(defaultConfig, config);
}

// Install listener
chrome.runtime.onInstalled.addListener(async function (details) {
  if (details.reason == 'install') {
    // Install link
    chrome.tabs.create({url: install_url});
    // Uninstall link
    var uninstallUrlLink = uninstall_url;
    if (chrome.runtime.setUninstallURL) {
      chrome.runtime.setUninstallURL(uninstallUrlLink);
    }
  }
});

// Settings saving from settings page
chrome.runtime.onMessageExternal.addListener(async (request, sender, sendResponse) => {
  try {
    if (request.type == 'GET_DATA') {
      // Fetch data
      let storage_data_local = await chrome.storage.local.get(null);
      let storage_data_sync = await chrome.storage.sync.get(null);
      // Send tracking event
      track('settings_open', {
        local_storage: storage_data_local,
        sync_storage: storage_data_sync
      }).catch(() => {});
      // Send response
      sendResponse({
        success: true,
        settings: await generateConfig(storage_data_local)
      });
    } else if (request.type == 'SET_DATA') {
      // Fetch data
      let storage_data_local = await chrome.storage.local.get(null);
      let storage_data_sync = await chrome.storage.sync.get(null);
      // Set settings
      await chrome.storage.sync.set(await generateConfig(Object.assign(storage_data_sync, request.settings)));
      // Send tracking event
      track('settings_change', {
        local_storage: storage_data_local,
        sync_storage: storage_data_sync
      }).catch(() => {});
      // Send response
      sendResponse({
        success: true
      });
    }
    if (request.type == 'RESET_DATA') {
      // Fetch data
      let storage_data_local = await chrome.storage.local.get(null);
      let storage_data_sync = await chrome.storage.sync.get(null);
      // Clear storage
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      // Send tracking event
      track('settings_clear', {
        local_storage: storage_data_local,
        sync_storage: storage_data_sync
      }).catch(() => {});
      // Send response
      sendResponse({
        success: true
      });
    }
  } catch (e) {
    // Automatic error reporting
    track('error_detected', {
      location: 'js.background.js-chrome.runtime.onMessageExternal',
      error_msg: e.toString(),
      error_stack: e.stack
    }).catch(() => {});
  }
});
