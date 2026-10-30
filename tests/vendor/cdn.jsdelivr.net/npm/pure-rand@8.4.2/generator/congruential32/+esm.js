/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/pure-rand@8.4.2/lib/esm/generator/congruential32.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
const u=214013,a=2531011,L=4294967295,R=-2147483649,T=-1443076087,N=505908858,h=1170746341,_=-755606699,l=1994129409,P=916127744;var s=class o{constructor(t){this.seed=t}clone(){return new o(this.seed)}next(){const t=this.seed,M=Math.imul(t,214013)+2531011|0,r=Math.imul(t,-1443076087)+505908858|0,e=Math.imul(t,1170746341)+-755606699|0;this.seed=e;const c=(M&-2147483649)>>16,E=(r&-2147483649)>>16;return(e&-2147483649)>>16|E<<15|c<<30}jump(){this.seed=Math.imul(this.seed,1994129409)+916127744&4294967295}getState(){return[this.seed]}};function I(n){if(n.length!==1)throw new Error("The state must have been produced by a congruential32 RandomGenerator");return new s(n[0])}function i(n){return new s(n)}export{i as congruential32,I as congruential32FromState};
//# sourceMappingURL=/sm/b46c45d13ad952b71d57c9f50c9543f28867ba58c63848d86877e13163305576.map