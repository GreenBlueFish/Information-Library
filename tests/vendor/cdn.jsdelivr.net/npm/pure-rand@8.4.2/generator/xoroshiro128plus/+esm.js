/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/pure-rand@8.4.2/lib/esm/generator/xoroshiro128plus.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
const j=[3639956645,3750757012,1261568508,386426335];var w=class x{constructor(n,s,t,h){this.s01=n,this.s00=s,this.s11=t,this.s10=h}clone(){return new x(this.s01,this.s00,this.s11,this.s10)}next(){const n=this.s00+this.s10|0,s=this.s10^this.s00,t=this.s11^this.s01,h=this.s00,o=this.s01;return this.s00=h<<24^o>>>8^s^s<<16,this.s01=o<<24^h>>>8^t^(t<<16|s>>>16),this.s10=t<<5^s>>>27,this.s11=s<<5^t>>>27,n}jump(){let n=0,s=0,t=0,h=0,o=this.s01,e=this.s00,l=this.s11,u=this.s10;for(let a=0;a!==4;++a){const S=j[a];for(let p=1;p;p<<=1){S&p&&(n^=o,s^=e,t^=l,h^=u);const r=u^e,c=l^o,f=e,m=o;e=f<<24^m>>>8^r^r<<16,o=m<<24^f>>>8^c^(c<<16|r>>>16),u=c<<5^r>>>27,l=r<<5^c>>>27}}this.s01=n,this.s00=s,this.s11=t,this.s10=h}getState(){return[this.s01,this.s00,this.s11,this.s10]}};function b(i){if(i.length!==4)throw new Error("The state must have been produced by a xoroshiro128plus RandomGenerator");return new w(i[0],i[1],i[2],i[3])}function d(i){return new w(-1,~i,i|0,0)}export{d as xoroshiro128plus,b as xoroshiro128plusFromState};
//# sourceMappingURL=/sm/b419044eae2b14e548258d4ec4403b3529515ace8bd6d057d05140a17a19d576.map