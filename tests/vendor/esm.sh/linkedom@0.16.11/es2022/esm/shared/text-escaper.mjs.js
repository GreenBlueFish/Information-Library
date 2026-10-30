/* esm.sh - linkedom@0.16.11/esm/shared/text-escaper */
var{replace:t}="",e=/[<>&\xA0]/g,s={"\xA0":"&#160;","&":"&amp;","<":"&lt;",">":"&gt;"},a=c=>s[c],o=c=>t.call(c,e,a);export{o as escape};
//# sourceMappingURL=text-escaper.mjs.map