import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.mjs';

// Deliberately scoped to this application's JS dependencies. Unknown bare imports fail
// visibly rather than falling back to ancestor lookup outside the checkout.
export function localBuildFiles() {
  return {
    name: 'local-build-files',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        let file;
        if (args.kind === 'entry-point') file = path.resolve(ROOT, args.path);
        else if (args.path.startsWith('.')) file = path.resolve(path.dirname(args.importer), args.path);
        else if (args.path === 'three') file = path.join(ROOT, 'node_modules/three/build/three.module.js');
        else if (args.path.startsWith('three/')) file = path.join(ROOT, 'node_modules', args.path);
        else throw new Error(`Local build resolver does not support: ${args.path}`);
        file = fs.realpathSync(file);
        const relative = path.relative(fs.realpathSync(ROOT), file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Build file is outside this checkout: ${args.path}`);
        return { path: file, namespace: 'local-js' };
      });
      build.onLoad({ filter: /.*/, namespace: 'local-js' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'js' }));
    },
  };
}
