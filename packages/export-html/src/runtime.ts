/**
 * Runtime embedded in exported decks. Plain ES2017, no dependencies, no network.
 * Its SHA-256 goes into the file's CSP, so no other inline script can run, even if a title
 * or text value were somehow to escape into markup.
 */
export const DECK_RUNTIME = `(function(){
'use strict';
var slides=[].slice.call(document.querySelectorAll('.hps-slide'));
var stage=document.getElementById('hps-stage');
var notes=document.getElementById('hps-notes');
var counter=document.getElementById('hps-counter');
var help=document.getElementById('hps-help');
var store=document.getElementById('hps-assets');
var page={w:+document.documentElement.getAttribute('data-w')||1920,h:+document.documentElement.getAttribute('data-h')||1080};
var cur=0;
if(store){
  var assets=JSON.parse(store.textContent||'{}');
  var imgs=document.querySelectorAll('img[data-hps-asset]');
  for(var i=0;i<imgs.length;i++){var u=assets[imgs[i].getAttribute('data-hps-asset')];if(u)imgs[i].src=u;}
}
function fit(){
  var s=Math.min(window.innerWidth/page.w,window.innerHeight/page.h);
  stage.style.transform='translate('+Math.round((window.innerWidth-page.w*s)/2)+'px,'+Math.round((window.innerHeight-page.h*s)/2)+'px) scale('+s+')';
}
function show(n){
  if(!slides.length)return;
  cur=Math.max(0,Math.min(slides.length-1,n));
  for(var i=0;i<slides.length;i++){slides[i].classList.toggle('hps-active',i===cur);}
  counter.textContent=(cur+1)+' / '+slides.length;
  if(notes)notes.textContent=slides[cur].getAttribute('data-notes')||'';
  try{history.replaceState(null,'','#'+(cur+1));}catch(e){}
}
function toggleFull(){
  if(document.fullscreenElement)document.exitFullscreen();
  else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen();
}
document.addEventListener('keydown',function(e){
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  switch(e.key){
    case 'ArrowRight':case 'ArrowDown':case 'PageDown':case ' ':case 'Enter':show(cur+1);e.preventDefault();break;
    case 'ArrowLeft':case 'ArrowUp':case 'PageUp':case 'Backspace':show(cur-1);e.preventDefault();break;
    case 'Home':show(0);break;
    case 'End':show(slides.length-1);break;
    case 'f':case 'F':toggleFull();break;
    case 'n':case 'N':if(notes)notes.classList.toggle('hps-open');break;
    case '?':help.classList.toggle('hps-open');break;
  }
});
document.addEventListener('click',function(e){
  if(e.target.closest&&e.target.closest('a'))return;
  show(cur+(e.clientX<window.innerWidth*0.2?-1:1));
});
window.addEventListener('resize',fit);
window.addEventListener('hashchange',function(){var n=parseInt(location.hash.slice(1),10);if(n)show(n-1);});
document.documentElement.classList.add('hps-js');
fit();
show((parseInt(location.hash.slice(1),10)||1)-1);
})();`;

/** Stage CSS for exported decks: one slide on screen, every slide on paper. Works unscaled without JS. */
export const DECK_SHELL_CSS = `
html,body{margin:0;padding:0;background:#111;height:100%}
.hps-js,.hps-js body{overflow:hidden}
#hps-stage{transform-origin:0 0}
.hps-js #hps-stage{position:absolute;left:0;top:0}
.hps-js .hps-slide{display:none}
.hps-js .hps-slide.hps-active{display:block}
html:not(.hps-js) .hps-slide{margin:0 auto 24px}
#hps-counter{position:fixed;right:16px;bottom:12px;color:#94a3b8;font:14px system-ui,sans-serif;background:rgba(0,0,0,.45);padding:2px 10px;border-radius:12px;z-index:10}
#hps-notes,#hps-help{display:none;position:fixed;left:16px;bottom:44px;max-width:50%;max-height:40%;overflow:auto;white-space:pre-wrap;color:#f8fafc;background:rgba(15,23,42,.92);font:16px/1.5 system-ui,sans-serif;padding:12px 16px;border-radius:8px;z-index:10}
#hps-notes.hps-open,#hps-help.hps-open{display:block}
@media print{
  html,body{background:#fff;overflow:visible!important;height:auto}
  #hps-stage{transform:none!important;position:static!important}
  .hps-slide,.hps-js .hps-slide{display:block!important;break-after:page;page-break-after:always;margin:0}
  .hps-slide:last-child{break-after:auto;page-break-after:auto}
  #hps-counter,#hps-notes,#hps-help{display:none!important}
}
`;
