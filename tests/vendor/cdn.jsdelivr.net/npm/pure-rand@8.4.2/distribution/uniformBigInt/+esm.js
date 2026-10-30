/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/pure-rand@8.4.2/lib/esm/distribution/uniformBigInt.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
const a=BigInt,s=4294967296n;function f(l,n,i){const t=i-n+1n;let e=s,o=1;for(;e<t;)e<<=32n,++o;let u=c(o,l);if(u<t)return u+n;if(u+t<e)return u%t+n;const r=e-e%t;for(;u>=r;)u=c(o,l);return u%t+n}function c(l,n){let i=a(n.next()+2147483648);for(let t=1;t<l;++t){const e=n.next();i=(i<<32n)+a(e+2147483648)}return i}export{f as uniformBigInt};
//# sourceMappingURL=/sm/f933983ba09bd236806e4018fe5d1e2251d55345edc6baedfb4dec31b9fe0be6.map