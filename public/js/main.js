// Load all components into their placeholder elements
const components = [
  'header',
  'hero',
  'mass-schedule',
  'announcements',
  'readings',
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
});
