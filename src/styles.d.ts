// Module declarations for side-effect imports handled by the bundler.
//
// Vite handles `*.css` imports natively — it injects the stylesheet at build
// time. TypeScript 6 tightened side-effect import validation and now errors
// on `import './foo.css'` unless a declaration is present, so we declare
// the bundler-resolved asset types here.
declare module '*.css'