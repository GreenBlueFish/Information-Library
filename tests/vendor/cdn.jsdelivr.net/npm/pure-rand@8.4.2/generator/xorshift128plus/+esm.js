/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/pure-rand@8.4.2/lib/esm/generator/xorshift128plus.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
const x=[1667051007,2321340297,1548169110,304075285];var p=class m{constructor(n,h,s,t){this.s01=n,this.s00=h,this.s11=s,this.s10=t}clone(){return new m(this.s01,this.s00,this.s11,this.s10)}next(){const n=this.s00^this.s00<<23,h=this.s01^(this.s01<<23|this.s00>>>9),s=this.s10,t=this.s11,o=this.s00+s|0;return this.s01=t,this.s00=s,this.s11=h^t^h>>>18^t>>>5,this.s10=n^s^(n>>>18|h<<14)^(s>>>5|t<<27),o}jump(){let n=0,h=0,s=0,t=0,o=this.s01,e=this.s00,r=this.s11,l=this.s10;for(let u=0;u!==4;++u){const w=x[u];for(let c=1;c;c<<=1){w&c&&(n^=o,h^=e,s^=r,t^=l);const a=e^e<<23,f=o^(o<<23|e>>>9);o=r,e=l,l=a^l^(a>>>18|f<<14)^(l>>>5|r<<27),r=f^r^f>>>18^r>>>5}}this.s01=n,this.s00=h,this.s11=s,this.s10=t}getState(){return[this.s01,this.s00,this.s11,this.s10]}};function S(i){if(i.length!==4)throw new Error("The state must have been produced by a xorshift128plus RandomGenerator");return new p(i[0],i[1],i[2],i[3])}function j(i){return new p(-1,~i,i|0,0)}export{j as xorshift128plus,S as xorshift128plusFromState};
//# sourceMappingURL=/sm/792a12dac8c558b6d027f323ad813d6ed86ff7a6278a120f80b45a7f17f996d7.map