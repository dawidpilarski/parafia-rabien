// Load all components into their placeholder elements
const components = [
  'header',
  'hero',
  'announcements',
  'facebook-news',
  'readings',
  'mass-schedule',
  'about',
  'history',
  'groups',
  'contact',
  'footer',
];

Promise.all(
  components.map((name) =>
    fetch(`components/${name}.html`)
      .then((r) => r.text())
      .then((html) => {
        document.getElementById(`component-${name}`).innerHTML = html;
      })
  )
).then(() => {
  // Initialize AOS after all components are loaded
  AOS.init({
    duration: 750,
    easing: 'ease-out-quart',
    once: true,
    offset: 60,
  });

  // Load Facebook SDK after components are in the DOM
  window.fbAsyncInit = function () {
    FB.init({ xfbml: true, version: 'v21.0' });
  };
  const fbScript = document.createElement('script');
  fbScript.async = true;
  fbScript.src = 'https://connect.facebook.net/pl_PL/sdk.js';
  document.body.appendChild(fbScript);
});
