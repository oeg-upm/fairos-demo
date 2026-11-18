const DEFAULTS={apiBase:"http://prefairos.linkeddata.es",startPath:"/assess/algorithm/{algorithm}",resultPath:"/assess/score/{ticket}",pollSeconds:5,token:""};
let cfg={...DEFAULTS,...JSON.parse(localStorage.getItem("fairos-config")||"{}")};
let timer=null,currentResult=null,currentResourceMetadata={};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
function apiUrl(path){return cfg.apiBase.replace(/\/$/,"")+"/"+path.replace(/^\//,"")}
function headers(){const h={};if(cfg.token)h["Authorization"]=cfg.token;return h}
function showError(msg){$("#errorBox").textContent=msg;$("#errorBox").classList.remove("hidden")}
function clearError(){$("#errorBox").classList.add("hidden")}
function switchView(name){$$(".view").forEach(v=>v.classList.remove("active"));$("#"+name+"View").classList.add("active");$$(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name))}
$$(".nav-btn").forEach(b=>b.onclick=()=>{switchView(b.dataset.view);if(b.dataset.view==="jobs")renderJobs()});



let sourceMode="file";

$$(".source-tab").forEach(btn=>btn.onclick=()=>{
  sourceMode=btn.dataset.source;
  $$(".source-tab").forEach(b=>b.classList.toggle("active",b===btn));
  $("#fileSource").classList.toggle("active",sourceMode==="file");
  $("#urlSource").classList.toggle("active",sourceMode==="url");
});

async function fileFromUrl(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`Could not retrieve the URL (HTTP ${r.status}).`);
  const blob=await r.blob();
  const name=decodeURIComponent(new URL(url).pathname.split("/").pop()||"ro-crate-metadata.json");
  return new File([blob],name,{type:blob.type||"application/json"});
}

async function extractResourceMetadata(file){
  try{
    const crate=JSON.parse(await file.text());
    const graph=Array.isArray(crate["@graph"])?crate["@graph"]:[];
    const map={};
    graph.forEach(entity=>{
      const id=entity["@id"];
      if(!id)return;
      let types=entity["@type"]||[];
      if(!Array.isArray(types))types=[types];
      map[id]={
        title: entity.name || entity.title || entity.headline || "",
        type: types.map(t=>typeof t==="string"?t:(t?.["@id"]||"")).filter(Boolean)
      };
    });
    return map;
  }catch(e){
    console.warn("Could not parse RO-Crate metadata for resource labels",e);
    return {};
  }
}

function resourceInfo(resource){
  const direct=currentResourceMetadata[resource];
  if(direct)return direct;

  // RO-Crate entities often use relative @id values while assessment targets
  // can be absolute. Try matching by the end of the identifier as a fallback.
  const entries=Object.entries(currentResourceMetadata);
  const match=entries.find(([id])=>resource.endsWith(id.replace(/^\.?\//,"")));
  return match?.[1]||{title:"",type:[]};
}

function shortType(type){
  if(!type)return "";
  const value=String(type);
  return value.includes("/")||value.includes("#") ? value.split(/[\\/#]/).filter(Boolean).pop() : value;
}

async function startAssessment(){
  clearError();
  const algo=$("#algorithm").value.trim();
  if(!algo)return showError("Enter the assessment algorithm identifier.");

  let file;
  try{
    if(sourceMode==="file"){
      file=$("#roFile").files[0];
      if(!file)return showError("Select the ro-crate-metadata.json file.");
    }else{
      const url=$("#roUrl").value.trim();
      if(!url)return showError("Enter the URL of the Research Object metadata.");
      file=await fileFromUrl(url);
    }
    currentResourceMetadata=await extractResourceMetadata(file);
  }catch(e){
    return showError("Could not load the assessment input. "+e.message+" If this is a remote URL, it must allow browser CORS access.");
  }

  $("#startAssessment").disabled=true;
  try{
    const form=new FormData();
    form.append("file",file,file.name);
    const path=cfg.startPath.replace("{algorithm}",encodeURIComponent(algo));
    const r=await fetch(apiUrl(path),{method:"POST",headers:headers(),body:form});
    const text=await r.text();let d={};try{d=JSON.parse(text)}catch{}
    if(r.status!==202)throw new Error(`${r.status}: ${text||r.statusText}`);
    const ticket=d.ticket_id;
    if(!ticket)throw new Error("The API returned 202 but no ticket_id was found.");
    const location=r.headers.get("Location");
    saveJob({ticket,resource:sourceMode==="url"?$("#roUrl").value.trim():file.name,algorithm:algo,status:"RUNNING",created:new Date().toISOString(),location,resourceMetadata:currentResourceMetadata});
    poll(ticket,file.name,algo,location);
  }catch(e){showError("Assessment could not be started. "+e.message)}
  finally{$("#startAssessment").disabled=false}
}
$("#startAssessment").onclick=startAssessment;

function poll(ticket,resource,algo,location=null){
  clearInterval(timer);$("#runningCard").classList.remove("hidden");$("#ticketText").textContent=ticket;$("#runningText").textContent="Waiting for the assessment result…";
  const check=async()=>{
    try{
      const path=location || cfg.resultPath.replace("{ticket}",encodeURIComponent(ticket));
      const url=/^https?:\/\//i.test(path)?path:apiUrl(path);
      const r=await fetch(url,{headers:headers()});
      if(r.status===404||r.status===202){$("#runningText").textContent="Assessment is still running. Checking again automatically…";return}
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const d=await r.json();
      // Some job APIs return a wrapper before exposing the result.
      const status=String(d.status||d.state||"").toUpperCase();
      if(["PENDING","RUNNING","QUEUED","PROCESSING"].includes(status)){updateJob(ticket,{status:"RUNNING"});return}
      const result=d.result||d.assessment||d;
      if(result.scoredTestResults||String(result["@type"]||"").includes("BenchmarkScore")){
        clearInterval(timer);timer=null;$("#runningCard").classList.add("hidden");saveCompleted(ticket,resource,algo,result);renderResult(result);
      }else if(["FAILED","ERROR"].includes(status)){throw new Error(d.message||d.error||"Assessment job failed.")}
    }catch(e){clearInterval(timer);timer=null;$("#runningCard").classList.add("hidden");updateJob(ticket,{status:"ERROR",error:e.message});showError("Could not retrieve the job result. "+e.message)}
  };
  check();timer=setInterval(check,Math.max(2,+cfg.pollSeconds)*1000);
}
$("#cancelPolling").onclick=()=>{clearInterval(timer);timer=null;$("#runningCard").classList.add("hidden")};

function getJobs(){return JSON.parse(localStorage.getItem("fairos-jobs")||"[]")}
function setJobs(j){localStorage.setItem("fairos-jobs",JSON.stringify(j.slice(0,30)))}
function saveJob(j){let a=getJobs().filter(x=>x.ticket!==j.ticket);a.unshift(j);setJobs(a)}
function updateJob(ticket,patch){let a=getJobs();let i=a.findIndex(x=>x.ticket===ticket);if(i>=0){a[i]={...a[i],...patch};setJobs(a)}}
function saveCompleted(ticket,resource,algorithm,result){
  const existing=getJobs().find(x=>x.ticket===ticket);
  saveJob({ticket,resource,algorithm,status:"COMPLETED",created:existing?.created||new Date().toISOString(),result,resourceMetadata:existing?.resourceMetadata||currentResourceMetadata});
}
function renderJobs(){
  const list=$("#jobsList"),jobs=getJobs();if(!jobs.length){list.innerHTML='<div class="empty">No assessment jobs saved in this browser yet.</div>';return}
  list.innerHTML=jobs.map((j,i)=>`<article class="job" data-i="${i}"><div><h3>${esc(j.resource||"Unknown resource")}</h3><p>${esc(j.ticket)} · ${new Date(j.created).toLocaleString()}</p></div><span class="badge ${esc(j.status)}">${esc(j.status)}</span><p>${esc(j.algorithm||"")}</p></article>`).join("");
  $$(".job").forEach(el=>el.onclick=()=>{const j=jobs[+el.dataset.i];if(j.result){currentResourceMetadata=j.resourceMetadata||{};renderResult(j.result)}else if(j.status==="RUNNING"){currentResourceMetadata=j.resourceMetadata||{};switchView("assess");poll(j.ticket,j.resource,j.algorithm,j.location)}})
}
$("#clearJobs").onclick=()=>{localStorage.removeItem("fairos-jobs");renderJobs()};
$("#backToJobs").onclick=()=>{switchView("jobs");renderJobs()};

function normalizeLog(result){if(Array.isArray(result.log))return result.log;if(typeof result.log==="string"){try{const x=JSON.parse(result.log);return Array.isArray(x)?x:[]}catch{}}return[]}
function renderResult(result){
  currentResult=result;switchView("result");const tests=result.scoredTestResults||[];const pass=tests.filter(x=>x.value==="PASS").length,fail=tests.filter(x=>x.value==="FAIL").length;
  const logs=normalizeLog(result),score=Number(result.value);const targets=[...new Set(tests.map(t=>t.assessmentTarget?.["@id"]).filter(Boolean))];
  $("#resultHeader").innerHTML=`<div class="result-hero"><div><p class="eyebrow" style="color:#aee1d9">BENCHMARK SCORE</p><h1>FAIR Assessment Result</h1><p>${esc(result["@id"]||"")}</p></div><div class="score">${Number.isFinite(score)?score.toFixed(1):esc(result.value||"—")}<small>${Number.isFinite(score)?"%":""}</small></div></div>`;
  $("#summaryCards").innerHTML=`<div class="stat"><span>Tests</span><strong>${tests.length}</strong></div><div class="stat"><span>Passed</span><strong>${pass}</strong></div><div class="stat"><span>Failed</span><strong>${fail}</strong></div><div class="stat"><span>Resources</span><strong>${targets.length||logs.length||1}</strong></div>`;
  $("#rawJson").textContent=JSON.stringify(result,null,2);renderTests();
}
function resourceScoreInfo(resource){
  const logs=normalizeLog(currentResult||{});
  return logs.find(r=>r?.["@id"]===resource)
    || logs.find(r=>String(r?.["@id"]||"").endsWith(resource.replace(/^\.?\//,"")))
    || logs.find(r=>resource.endsWith(String(r?.["@id"]||"").replace(/^\.?\//,"")))
    || null;
}
function prettyGroupName(name){
  return String(name||"").replaceAll("_"," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function testIdentifier(t){return t?.outputFromTest?.["@id"]||""}
function shortTestId(uri){return String(uri||"").split(/[\/#]/).filter(Boolean).pop()||"Unknown test"}
function groupedTestIds(info){
 const s=new Set(),g=info?.grouped_results;
 if(g&&typeof g==="object") Object.values(g).forEach(x=>(Array.isArray(x?.tests)?x.tests:[]).forEach(t=>t?.test_id&&s.add(String(t.test_id))));
 return s;
}
function findDetailedTest(tests,id){
 return tests.find(t=>{const u=testIdentifier(t),s=shortTestId(u);return u===id||s===id||u.endsWith("/"+id)||u.endsWith("#"+id)});
}
function testDetailsHtml(t,valueOverride){
 if(!t)return "";
 const uri=testIdentifier(t),v=String(valueOverride||t.value||"").toUpperCase(),d=t.description||"";
 return `<div class="integrated-test"><div class="integrated-test-main"><div><div class="test-title">${esc(t.title||shortTestId(uri))}</div>${uri?`<a class="test-uri" href="${attr(uri)}" target="_blank" rel="noopener">${esc(shortTestId(uri))} ↗</a>`:""}</div><span class="badge ${esc(v)}">${esc(v||"UNKNOWN")}</span></div>${d?`<details class="test-description"><summary>Read more</summary><p>${esc(d)}</p></details>`:""}</div>`;
}
function groupedResultsHtml(info,tests){
 const groups=info?.grouped_results;if(!groups||typeof groups!=="object")return "";
 return `<section class="grouped-results"><div class="results-section-heading"><div><h4>Grouped results</h4><p>Complementary tests combined into a global result. Individual test information is included inside each group.</p></div></div><div class="group-results-grid">${Object.entries(groups).map(([name,g])=>{const gv=String(g?.value||"").toUpperCase();return `<div class="group-result"><div class="group-result-head ${gv === "PASS" ? "group-pass" : gv === "FAIL" ? "group-fail" : ""}"><div><strong>${esc(prettyGroupName(name))}</strong><small>${esc(name)}</small></div><span class="badge ${esc(gv)}">${esc(gv||"UNKNOWN")}</span></div><div class="group-tests">${(Array.isArray(g?.tests)?g.tests:[]).map(gt=>{const d=findDetailedTest(tests,String(gt?.test_id||""));if(d)return testDetailsHtml(d,gt?.value);const v=String(gt?.value||"").toUpperCase();return `<div class="integrated-test"><div class="integrated-test-main"><code>${esc(gt?.test_id||"Unknown test")}</code><span class="badge ${esc(v)}">${esc(v||"UNKNOWN")}</span></div></div>`}).join("")}</div></div>`}).join("")}</div></section>`;
}
function renderTests(){
 const tests=currentResult?.scoredTestResults||[],q=$("#testSearch").value.toLowerCase(),status=$("#statusFilter").value;
 const filtered=tests.filter(t=>(!status||t.value===status)&&(!q||`${t.title} ${t.description} ${t.outputFromTest?.["@id"]} ${t.assessmentTarget?.["@id"]}`.toLowerCase().includes(q)));
 if(!filtered.length){$("#tests").innerHTML='<div class="empty">No matching tests.</div>';return}
 const groups=new Map();filtered.forEach(t=>{const r=t.assessmentTarget?.["@id"]||"Unspecified resource";if(!groups.has(r))groups.set(r,[]);groups.get(r).push(t)});
 $("#tests").innerHTML=[...groups.entries()].map(([resource,rt])=>{
  const passed=rt.filter(t=>t.value==="PASS").length,failed=rt.filter(t=>t.value==="FAIL").length,other=rt.length-passed-failed;
  const info=resourceInfo(resource),si=resourceScoreInfo(resource),ids=groupedTestIds(si);
  const standalone=rt.filter(t=>{const u=testIdentifier(t),s=shortTestId(u);return !ids.has(u)&&!ids.has(s)});
  const typeLabel=(info.type||[]).map(shortType).join(", ")||"Type not available",title=info.title||"Untitled resource";
  const pct=si?.percentage,scoreLabel=pct==null?"—":`${pct}%`,total=si?.total??rt.length,totalPassed=si?.passed??passed,totalFailed=si?Math.max(0,total-totalPassed):failed;
  return `<details class="resource-group"><summary class="resource-header"><div class="resource-main"><div class="resource-chevron">›</div><div><p class="eyebrow">ASSESSED RESOURCE</p><h3>${esc(title)}</h3><div class="resource-type">${esc(typeLabel)}</div><div class="resource-id">${esc(resource)}</div></div></div><div class="resource-stats"><span class="resource-score"><b>${esc(scoreLabel)}</b><small>score</small></span><span>${total} tests</span><span class="resource-pass">${totalPassed} passed</span><span class="resource-fail">${totalFailed} failed</span>${other?`<span>${other} other</span>`:""}</div></summary><div class="resource-results">${groupedResultsHtml(si,rt)}${standalone.length?`<section class="individual-results"><div class="results-section-heading"><div><h4>Individual test results</h4><p>Tests not included in any grouped result.</p></div></div>${standalone.map(t=>testDetailsHtml(t)).join("")}</section>`:""}</div></details>`;
 }).join("");
}
$("#testSearch").oninput=renderTests;$("#statusFilter").onchange=renderTests;
$("#downloadJson").onclick=()=>{if(!currentResult)return;const blob=new Blob([JSON.stringify(currentResult,null,2)],{type:"application/ld+json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="fairos-assessment.jsonld";a.click();URL.revokeObjectURL(a.href)};

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function attr(v){return esc(v)}

const dlg=$("#settingsDialog");
$("#settingsBtn").onclick=()=>{$("#apiBase").value=cfg.apiBase;$("#apiToken").value=cfg.token||"";$("#startPath").value=cfg.startPath;$("#resultPath").value=cfg.resultPath;$("#pollSeconds").value=cfg.pollSeconds;dlg.showModal()}
$("#saveSettings").onclick=e=>{e.preventDefault();cfg={apiBase:$("#apiBase").value.trim(),token:$("#apiToken").value.trim(),startPath:$("#startPath").value.trim(),resultPath:$("#resultPath").value.trim(),pollSeconds:+$("#pollSeconds").value||5};localStorage.setItem("fairos-config",JSON.stringify(cfg));dlg.close()};
