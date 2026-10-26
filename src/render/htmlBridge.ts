/**
 * HTML 代码层的时间同步桥。
 *
 * 问题：`html` 代码层在编辑态是一个 `sandbox="allow-scripts"` 的 iframe，
 * 里面如果是 GSAP / CSS 动画，它会**自己按真实时间跑**——跟主时间轴的播放头毫无关系。
 * 于是同一个画面里，原生图层是被时间轴驱动的、HTML 层是自己跑的，两者对不上。
 *
 * 解法：往 iframe 的 HTML 里注入一小段桥接脚本，让它
 *   ① 一加载就把动画冻结（gsap.globalTimeline.pause / getAnimations().pause）
 *   ② 收到宿主的 `{ kly: <token>, type: 'time', ms }` 后 seek 到指定毫秒
 *   ③ 就绪后给宿主发一条 `ready`，宿主据此开始推时间
 *
 * 安全边界（这段必须写在代码里，不然以后没人记得）：
 *   · 这个 iframe 没有 `allow-same-origin`，所以它的 `event.origin` 恒为 `"null"`。
 *     **用 origin 做校验在这里毫无意义** —— 任何沙箱 iframe 发来的都是 "null"。
 *   · 真正可靠的身份校验是 `event.source === iframe.contentWindow`（宿主侧），
 *     以及消息里的随机 token（iframe 侧）。两者都不依赖 origin。
 *   · token 每个图层一个，写成图层 id 的派生值：A 层拿不到 B 层的消息，
 *     也就没法驱动别人的画面（虽然驱动了也只在用户的浏览器里）。
 *   · 桥接脚本在 `<head>` 最前面注入，保证先于用户脚本执行 —— 冻结要赶在动画起跑之前。
 */

/** 注入脚本的标记属性，方便调试与「这层是否被桥接过」的判断 */
export const BRIDGE_MARK = 'data-kly-bridge';

/** 图层 id → token。稳定（同一个图层每次渲染都一样），但不像 id 那么容易被猜到用途 */
export function bridgeToken(layerId: string): string {
  let hash = 0;
  for (let i = 0; i < layerId.length; i += 1) {
    hash = (hash * 31 + layerId.charCodeAt(i)) | 0;
  }
  return `kly${(hash >>> 0).toString(36)}`;
}

/**
 * 桥接脚本正文。
 *
 * 刻意写成 ES5：iframe 里没有构建管线，用户也可能塞了老式 DOCTYPE，
 * 这段代码必须在任何浏览器里都能跑，语法错误会让整层直接白屏。
 *
 * 导出是为了自检（`scripts/html-check.mjs` 会在假 window 里跑一遍，
 * 验「token 不对就不动」「time 消息真的 seek 到点」「bounds 算得对」），
 * 生产代码只有 injectBridge 调它。
 *
 * 除了时间同步，它还负责**量内容包围盒**：sandbox iframe 的白底在 Chrome 里
 * 无论如何都去不掉（文档 html/body 透明也没用，实测过），所以只能反其道 ——
 * 让 iframe 的背景色等于画布底色，再把 iframe 收缩到「真有内容的那块矩形」。
 * 这样它最多挡住自己那几个元素，不会把整张画布糊成一片。
 */
export function bridgeBody(token: string): string {
  return `(function(){
var TOKEN=${JSON.stringify(token)};
function freeze(){
  try{var g=window.gsap;if(g&&g.globalTimeline)g.globalTimeline.pause();}catch(e){}
  try{var a=document.getAnimations?document.getAnimations():[];for(var i=0;i<a.length;i++){a[i].pause();}}catch(e){}
}
function seek(ms){
  var moved=false;
  try{var g=window.gsap;if(g&&g.globalTimeline){g.globalTimeline.pause();g.globalTimeline.time(ms/1000);moved=true;}}catch(e){}
  if(!moved){
    try{var a=document.getAnimations?document.getAnimations():[];for(var i=0;i<a.length;i++){a[i].pause();a[i].currentTime=ms;}}catch(e){}
  }
}
/* 内容包围盒：把所有可见元素的 rect 并起来，再把自己整块挪到 (0,0) */
function measure(){
  var all=document.body?document.body.querySelectorAll('*'):[];
  var box=null;
  for(var i=0;i<all.length;i++){
    var el=all[i];
    var tag=el.tagName;
    if(tag==='SCRIPT'||tag==='STYLE'||tag==='META'||tag==='LINK')continue;
    var r=el.getBoundingClientRect();
    if(r.width<=0||r.height<=0)continue;
    if(!box){box={l:r.left,t:r.top,r:r.right,b:r.bottom};}
    else{
      if(r.left<box.l)box.l=r.left;
      if(r.top<box.t)box.t=r.top;
      if(r.right>box.r)box.r=r.right;
      if(r.bottom>box.b)box.b=r.bottom;
    }
  }
  if(!box)return null;
  var x=Math.max(0,Math.floor(box.l)),y=Math.max(0,Math.floor(box.t));
  var w=Math.max(1,Math.ceil(box.r-x)),h=Math.max(1,Math.ceil(box.b-y));
  try{
    document.documentElement.style.overflow='hidden';
    document.body.style.transformOrigin='0 0';
    document.body.style.transform='translate('+(-x)+'px,'+(-y)+'px)';
  }catch(e){}
  return {x:x,y:y,w:w,h:h};
}
function report(){
  var b=measure();
  if(b){try{parent.postMessage({kly:TOKEN,type:'bounds',box:b},'*');}catch(e){}}
}
window.addEventListener('message',function(e){
  var d=e.data;
  if(!d||d.kly!==TOKEN)return;
  if(d.type==='time'&&typeof d.ms==='number')seek(d.ms);
  /* 宿主在 iframe onLoad 时主动要一次：自动上报有竞态（宿主可能还没装监听） */
  if(d.type==='measure')report();
});
/* 冻结要持续一段时间：gsap 可能来自 CDN，比这段脚本晚到 */
var tries=0;
var timer=setInterval(function(){freeze();if(++tries>300)clearInterval(timer);},16);
/* 布局要等一帧才稳（图片、字体可能还在解码），DOMContentLoaded 当下量会偏小 */
function soon(){requestAnimationFrame?requestAnimationFrame(function(){report();}):setTimeout(report,16);}
document.addEventListener('DOMContentLoaded',function(){freeze();soon();});
window.addEventListener('load',function(){freeze();soon();});
try{parent.postMessage({kly:TOKEN,type:'ready'},'*');}catch(e){}
})();`;
}

/** 把桥接脚本注入 HTML 最靠前的位置；已经注入过就不重复注入 */
export function injectBridge(html: string, token: string): string {
  if (html.includes(BRIDGE_MARK)) return html;
  const tag = `<script ${BRIDGE_MARK}="${token}">${bridgeBody(token)}</script>`;

  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  const body = /<body[^>]*>/i.exec(html);
  if (body) {
    const at = body.index + body[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  return `${tag}${html}`;
}

/** 宿主 → iframe 的一条时间消息 */
export interface TimeMessage {
  kly: string;
  type: 'time';
  ms: number;
}

/** iframe 的行为只有这两种，其余一律忽略（避免把任意消息当成指令） */
export type BridgeMessage = { kly: string; type: 'ready' } | TimeMessage;
