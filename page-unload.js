// Send a user event to Honeycomb every time someone loads a page in the browser
// so we can capture perf & device stats.
//
// Assumes the presence of `window`, `window.performance`, `window.navigator`,
// and `window.performance.timing` objects
import _ from "underscore";
import honeycomb from "../honeycomb";

// Randomly generate a page load ID so we can correlate load/unload events
export let pageLoadId = Math.floor(Math.random() * 100000000);

// Memory usage stats collected as soon as JS executes, so we can compare the
// delta later on page unload
export let jsHeapUsed = window.performance.memory && window.performance.memory.usedJSHeapSize;
const jsHeapTotal = window.performance.memory && window.performance.memory.totalJSHeapSize;

// Names of static asset files we care to collect metrics about
const trackedAssets = ["/main.css", "/main.js"];

// Returns a very wide event of perf/client stats to send to Honeycomb
const pageLoadEvent = function() {
  const nt = window.performance.timing;

  const event = {
    type: "page-load",
    page_load_id: pageLoadId,

    // User agent. We can parse the user agent into device, os name, os version,
    // browser name, and browser version fields server-side if we want to later.
    user_agent: window.navigator.userAgent,

    // Current window size & screen size stats
    // We use a derived column in Honeycomb to also be able to query window
    // total pixels and the ratio of window size to screen size. That way we
    // can understand whether users are making their window as large as they can
    // to try to fit Honeycomb content on screen, or whether they find a smaller
    // window size more comfortable.
    //
    // Capture how large the user has made their current window
    window_height: window.innerHeight,
    window_width: window.innerWidth,
    // Capture how large the user's entire screen is
    screen_height: window.screen && window.screen.height,
    screen_width: window.screen && window.screen.width,

    // The shape of the current url, similar to collecting rail's controller +
    // action, so we know which type of page the user was on. e.g.
    //   "/:team_slug/datasets/:dataset_slug/triggers"
    path_shape: document.querySelector('meta[name=goji-path]').content,

    // Chrome-only (for now) information on internet connection type (4g, wifi, etc.)
    // https://developers.google.com/web/updates/2017/10/nic62
    connection_type: navigator.connection && navigator.connection.type,
    connection_type_effective: navigator.connection && navigator.connection.effectiveType,
    connection_rtt: navigator.connection && navigator.connection.rtt,

    // Navigation (page load) timings, transformed from timestamps into deltas
    timing_unload_ms: nt.unloadEnd - nt.navigationStart,
    timing_dns_end_ms: nt.domainLookupEnd - nt.navigationStart,
    timing_ssl_end_ms: nt.connectEnd - nt.navigationStart,
    timing_response_end_ms: nt.responseEnd - nt.navigationStart,
    timing_dom_interactive_ms: nt.domInteractive - nt.navigationStart,
    timing_dom_complete_ms: nt.domComplete - nt.navigationStart,
    timing_dom_loaded_ms: nt.loadEventEnd - nt.navigationStart,
    timing_ms_first_paint: nt.msFirstPaint - nt.navigationStart, // Nonstandard IE/Edge-only first paint

    // Some calculated navigation timing durations, for easier graphing in Honeycomb
    // We could also use a derived column to do these calculations in the UI
    // from the above fields if we wanted to keep our event payload smaller.
    timing_dns_duration_ms: nt.domainLookupEnd - nt.domainLookupStart,
    timing_ssl_duration_ms: nt.connectEnd - nt.connectStart,
    timing_server_duration_ms: nt.responseEnd - nt.requestStart,
    timing_dom_loaded_duration_ms: nt.loadEventEnd - nt.domComplete,

    // Entire page load duration
    timing_total_duration_ms: nt.loadEventEnd - nt.connectStart,
  };

  // First paint data via PerformancePaintTiming (Chrome only for now)
  const hasPerfTimeline = !!window.performance.getEntriesByType;
  if (hasPerfTimeline) {
    let paints = window.performance.getEntriesByType("paint");

    // Loop through array of two PerformancePaintTimings and send both
    _.each(paints, function(paint) {
      if (paint.name === "first-paint") {
        event.timing_first_paint_ms = paint.startTime;
      } else if (paint.name === "first-contentful-paint") {
        event.timing_first_contentful_paint_ms = paint.startTime;
      }
    });
  }

  // Redirect count (inconsistent browser support)
  // Find out if the user was redirected on their way to landing on this page,
  // so we can have visibility into whether redirects are slowing down the experience
  event.redirect_count = window.performance.navigation && window.performance.navigation.redirectCount;

  // Memory info (Chrome) — also send this on unload so we can compare heap size
  // and understand how much memory we're using as the user interacts with the page
  if (window.performance.memory) {
    event.js_heap_size_total_b = jsHeapTotal;
    event.js_heap_size_used_b = jsHeapUsed;
  }

  // ResourceTiming stats
  // We don't care about getting stats for every single static asset, but we do
  // care about the overall count (e.g. which pages could be slow because they
  // make a million asset requests?) and the sizes of key files (are we sending
  // our users massive js files that could slow down their experience? should we
  // be code-splitting for more manageable file sizes?).
  if (hasPerfTimeline) {
    let resources = window.performance.getEntriesByType("resource");
    event.resource_count = resources.length;

    // Loop through resources looking for ones that match tracked asset names
    _.each(resources, function(resource) {
      const fileName = _.find(trackedAssets, fileName => resource.name.indexOf(fileName) > -1);
      if (fileName) {
        // Don't put chars like . and / in the key name
        const name = fileName.replace("/", "").replace(".", "_");

        event[`resource_${name}_encoded_size_kb`] = resource.encodedBodySize;
        event[`resource_${name}_decoded_size_kb`] = resource.decodedBodySize;
        event[`resource_${name}_timing_duration_ms`] = resource.responseEnd - resource.startTime;
      }
    });
  }

  return event;
};


// Send this wide event we've constructed after the page has fully loaded
window.addEventListener("load", function() {
  // Wait a tick so this all runs after any onload handlers
  setTimeout(function() {
    // Sends the event to our servers for forwarding on to api.honeycomb.io
    honeycomb.sendEvent(pageLoadEvent());
  }, 0);
});
