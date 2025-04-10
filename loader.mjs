// loader.mjs
import { pathToFileURL } from 'url';

export function resolve(specifier, context, nextResolve) {
  // Check if it's our problematic import
  if (specifier === './bitcoin' && 
      context.parentURL.includes('clarity-bitcoin-client/dist')) {
    // Redirect to the actual file with .js extension
    const parentURL = new URL(context.parentURL);
    const newURL = new URL('./bitcoin.js', parentURL).href;
    return {
      url: newURL,
      shortCircuit: true
    };
  }
  
  // Let Node.js handle all other imports
  return nextResolve(specifier, context);
}
