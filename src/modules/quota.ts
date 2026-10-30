import type { FeatureModule, Adapter, QuotaBinding } from "./types";
import { quotaView, remaining } from "./quota-model";

export const quotaTarget = "webview/assets/app-primary-b7f335b763ca.js";
const marker = "/* chatgpt-modder:quota@4 */";
// All host symbols below are bound to one fingerprinted client build, never guessed at runtime.
export const legacyQuotaBinding: QuotaBinding = {
  target: quotaTarget,
  profile: "Ozn",
  react: "Mzn",
  jsx: "eK",
  account: "Xw",
  read: "Q",
  query: "ab",
  scopeHook: "Fi",
  scope: "$",
  guards: [],
};
export function quotaRuntime(binding: QuotaBinding = legacyQuotaBinding) {
  return `${marker}
${remaining.toString()}
${quotaView.toString()}
function CGMQuota(props){
 const R=${binding.react},account=${binding.account}(),query=${binding.read}(${binding.query}),scope=${binding.scopeHook}(${binding.scope}),[now,setNow]=R.useState(Date.now),lastReset=R.useRef('');
 R.useEffect(()=>{const tick=()=>setNow(Date.now());const timer=setInterval(tick,10000);window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick)}},[]);
 const view=quotaView(query.data,account.accountId,account.userId,now,query.isError||account.authMethod!=='chatgpt');
 R.useEffect(()=>{if(!view.needsRefresh)return;const key=String(account.accountId)+':'+Math.floor(now/60000);if(lastReset.current===key)return;lastReset.current=key;scope.query.invalidate(${binding.query})},[view.needsRefresh,now,account.accountId,scope]);
 return ${binding.jsx}.jsx(CGMQuotaDisplay,{compact:props.compact,center:props.center,view});
}
function CGMQuotaDisplay(props){
 const view=props.view;
 const text=view.five==null?'--%':Math.round(view.five)+'%',label=view.week==null?'周剩余额度暂不可用':'周剩余 '+Math.round(view.week)+'%';
 const bar=${binding.jsx}.jsx('div',{role:'progressbar','aria-label':label,'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':view.week==null?undefined:view.week,title:label,style:{height:1,width:'100%',overflow:'hidden',background:'color-mix(in srgb,currentColor 15%,transparent)'},children:${binding.jsx}.jsx('div',{style:{height:'100%',width:(view.week??0)+'%',background:'currentColor',opacity:view.week==null?0:.7}})});
 return ${binding.jsx}.jsxs('div',{'data-cgm-quota':'1',style:{display:'grid',gridTemplateColumns:'max-content',justifyItems:'center',gap:3,padding:'6px 0',fontVariantNumeric:'tabular-nums',fontSize:12,lineHeight:'16px',color:'var(--text-default,inherit)',width:'max-content',marginLeft:props.center??(props.compact?22:16),transform:'translateX(-50%)',boxSizing:'border-box'},children:[${binding.jsx}.jsx('span',{title:'5H 剩余额度',style:{color:view.five!=null&&view.five<=10?'var(--text-danger,#dc4545)':undefined},children:text}),${binding.jsx}.jsxs('div',{'data-cgm-time-group':'1',style:{display:'grid',gridTemplateColumns:'max-content',gap:3},children:[${binding.jsx}.jsx('span',{'data-cgm-countdown':'1',title:'距 5H 重置',style:{fontSize:props.compact?9:11,opacity:.65,whiteSpace:'nowrap'},children:view.countdown}),bar]})]})
}
var CGMQuotaBoundary;
function ${binding.profile}(props){
 const R=${binding.react},root=R.useRef(null),profile=R.useRef(null),[center,setCenter]=R.useState(null);
 R.useLayoutEffect(()=>{
  const update=()=>{const button=profile.current?.querySelector('button');if(!button||!root.current)return;const icon=Array.from(button.children).find(el=>{const r=el.getBoundingClientRect();return r.width>=8&&r.width<=40&&r.height>=8});const r=(icon??button).getBoundingClientRect();if(!r.width)return;const x=r.left+r.width/2-root.current.getBoundingClientRect().left;setCenter(old=>old!=null&&Math.abs(old-x)<.25?old:x)};
  update();const resize=typeof ResizeObserver==='function'?new ResizeObserver(update):null;const mutation=typeof MutationObserver==='function'?new MutationObserver(update):null;if(profile.current){resize?.observe(profile.current);mutation?.observe(profile.current,{childList:true,subtree:true,attributes:true})}window.addEventListener('resize',update);return()=>{resize?.disconnect();mutation?.disconnect();window.removeEventListener('resize',update)}
 },[props?.compact]);
 if(!CGMQuotaBoundary)CGMQuotaBoundary=class extends ${binding.react}.Component{constructor(p){super(p);this.state={failed:false}}static getDerivedStateFromError(){return{failed:true}}render(){return this.state.failed?null:this.props.children}};
 return ${binding.jsx}.jsxs('div',{ref:root,style:{display:'flex',flexDirection:'column',minWidth:0,width:'100%'},children:[${binding.jsx}.jsx(CGMQuotaBoundary,{children:${binding.jsx}.jsx(${binding.react}.Suspense,{fallback:${binding.jsx}.jsx(CGMQuotaDisplay,{compact:props?.compact,center,view:{five:null,week:null,countdown:'--h--m'}}),children:${binding.jsx}.jsx(CGMQuota,{compact:props?.compact,center})})}),${binding.jsx}.jsx('div',{ref:profile,style:{width:'100%',minWidth:0},children:${binding.jsx}.jsx(CGMOriginalProfile,props??{})})]})}

`;
}
export const quotaModule: FeatureModule = {
  id: "quota",
  version: "1.0.3",
  name: "侧栏额度",
  description: "5H 剩余百分比、重置倒计时及周额度细进度条",
  dependencies: [],
  conflicts: [],
  targets: [quotaTarget],
  prepare(files) {
    const before = files.get(quotaTarget);
    if (
      !before ||
      before.split("function Ozn(e){").length !== 2 ||
      before.includes(marker)
    )
      throw Error("额度模块锚点不匹配或已被修改");
    return [
      {
        path: quotaTarget,
        before,
        after:
          before.replace(
            "function Ozn(e){",
            "function CGMOriginalProfile(e){",
          ) +
          "\n" +
          quotaRuntime(),
      },
    ];
  },
  verify(files) {
    const s = files.get(quotaTarget) ?? "";
    return (
      s.includes(marker) &&
      s.includes("function CGMOriginalProfile(e){") &&
      s.includes("function Ozn(props){") &&
      s.includes("Mzn.Suspense") &&
      s.includes("function CGMQuotaDisplay(props){")
    );
  },
};
export function quotaFor(binding: QuotaBinding): FeatureModule {
  const anchor = "function " + binding.profile + "(e){";
  return {
    ...quotaModule,
    version: "1.1.0",
    targets: [binding.target],
    prepare(files) {
      const before = files.get(binding.target);
      if (
        !before ||
        before.split(anchor).length !== 2 ||
        before.includes(marker) ||
        binding.guards.some((guard) => !before.includes(guard))
      )
        throw Error("额度模块版本锚点不匹配或已被修改");
      return [
        {
          path: binding.target,
          before,
          after:
            before.replace(anchor, "function CGMOriginalProfile(e){") +
            "\n" +
            quotaRuntime(binding),
        },
      ];
    },
    verify(files) {
      const s = files.get(binding.target) ?? "";
      return (
        s.includes(marker) &&
        s.includes("function CGMOriginalProfile(e){") &&
        s.includes("function " + binding.profile + "(props){") &&
        s.includes(binding.react + ".Suspense") &&
        s.includes("query=" + binding.read + "(" + binding.query + ")")
      );
    },
  };
}
export function modulesForAdapter(adapter: Adapter): FeatureModule[] {
  return builtInModules.map((module) =>
    module.id === "quota" && adapter.quota ? quotaFor(adapter.quota) : module,
  );
}
export const builtInModules: FeatureModule[] = [quotaModule];
export function resolveModules(
  ids: string[],
  registry: FeatureModule[] = builtInModules,
) {
  if (new Set(ids).size !== ids.length) throw Error("功能模块重复");
  const selected = ids.map((id) => {
    const m = registry.find((m) => m.id === id);
    if (!m) throw Error(`未知模块：${id}`);
    return m;
  });
  const sorted: FeatureModule[] = [],
    visiting = new Set<string>();
  function visit(m: FeatureModule) {
    if (sorted.includes(m)) return;
    if (visiting.has(m.id)) throw Error("模块存在循环依赖");
    visiting.add(m.id);
    for (const dep of m.dependencies) {
      const d = selected.find((x) => x.id === dep);
      if (!d) throw Error(`缺少依赖：${dep}`);
      visit(d);
    }
    for (const c of m.conflicts)
      if (ids.includes(c)) throw Error(`模块冲突：${m.id} / ${c}`);
    visiting.delete(m.id);
    sorted.push(m);
  }
  selected.forEach(visit);
  const owners = new Map<string, string>();
  for (const m of sorted)
    for (const target of m.targets) {
      if (owners.has(target))
        throw Error(`修改目标冲突：${owners.get(target)} / ${m.id}`);
      owners.set(target, m.id);
    }
  return sorted;
}
