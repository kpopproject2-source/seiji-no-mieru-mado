export const normalizeName = value => String(value || '').normalize('NFKC').replace(/[\s　・･]/g, '');
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
export function safeURL(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
export function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '未確認';
  const amount = Number(value);
  if (Math.abs(amount) >= 1e12) return `${Number((amount / 1e12).toFixed(4)).toLocaleString('ja-JP')}兆円`;
  if (Math.abs(amount) >= 1e8) return `${Number((amount / 1e8).toFixed(4)).toLocaleString('ja-JP')}億円`;
  if (Math.abs(amount) >= 1e4) return `${Number((amount / 1e4).toFixed(4)).toLocaleString('ja-JP')}万円`;
  return `${amount.toLocaleString('ja-JP')}円`;
}
export function amountText(record, field) {
  const label = record[field.replace(/JPY$/, 'Label')];
  if (label) return String(label);
  return money(record[field]);
}
export function supportReference(record) {
  if (record.announcedAmountJPY !== null && record.announcedAmountJPY !== undefined) return {kind:'announcement',label:record.referenceLabel || '発表額・供与限度額',value:record.announcedAmountJPY,text:amountText(record,'announcedAmountJPY'),period:record.announcedPeriod};
  if (record.budgetAmountJPY !== null && record.budgetAmountJPY !== undefined) return {kind:'budget',label:'予算額',value:record.budgetAmountJPY,text:amountText(record,'budgetAmountJPY'),period:record.announcedPeriod};
  return {kind:'unknown',label:'発表額',value:null,text:'未確認',period:record.announcedPeriod};
}
export function paymentRatio(record) {
  if (record.isDemo || !record.comparableAmounts || record.paidAmountIsDerived || record.paidAmountIsApproximate) return null;
  const reference = supportReference(record);
  if (reference.kind !== 'announcement' || reference.value <= 0 || record.paidAmountJPY === null || record.paidAmountJPY === undefined || record.paidAmountJPY < 0 || record.paidAmountJPY > reference.value) return null;
  return record.paidAmountJPY / reference.value;
}
export function filterSupport(records, {region='all',type='all',query=''}={}) {
  const search = String(query).trim().toLocaleLowerCase('ja');
  return records.filter(record => (region === 'all' || record.region === region) && (type === 'all' || record.supportType === type) && (!search || `${record.title} ${record.recipient} ${(record.implementingBodies || []).join(' ')}`.toLocaleLowerCase('ja').includes(search)));
}
export function filterPoliticians(records, {query='',house='all',party='all',followedOnly=false,followed=[]}={}) {
  const search = normalizeName(query).toLocaleLowerCase('ja');
  return records.filter(person => (house === 'all' || person.house === house) && (party === 'all' || person.currentParty === party) && (!followedOnly || followed.includes(person.id)) && (!search || normalizeName(`${person.name} ${person.kana || ''} ${person.district || ''} ${person.currentParty || ''} ${person.caucus || ''}`).toLocaleLowerCase('ja').includes(search)));
}
export function filterElections(elections,candidates,{query='',prefecture='all',type='all',party='all',proportionalCandidacies=[]}={}) {
  const search=normalizeName(query).toLocaleLowerCase('ja');
  const candidateMatches=candidates.filter(candidate=>(party==='all'||candidate.partyAtElection===party)&&(!search||normalizeName(`${candidate.name} ${candidate.kana||candidate.reading||''} ${candidate.partyAtElection||''}`).toLocaleLowerCase('ja').includes(search)));
  const candidateIDs=new Set(candidateMatches.map(candidate=>candidate.id));
  const matches=new Set(candidateMatches.map(candidate=>candidate.electionId));
  for(const entry of proportionalCandidacies)if((candidateIDs.has(entry.candidateId)||search&&normalizeName(`${entry.listedName||''} ${entry.partyAtElection||''}`).toLocaleLowerCase('ja').includes(search))&&(party==='all'||entry.partyAtElection===party))matches.add(entry.electionId);
  return elections.filter(election=>(type==='all'||(election.electionType||'constituency')===type)&&(prefecture==='all'||election.prefecture===prefecture||election.prefectures?.includes(prefecture))&&(party==='all'||matches.has(election.id))&&(!search||matches.has(election.id)||normalizeName(`${election.name} ${election.district||''} ${election.prefecture||''} ${election.block||''}`).toLocaleLowerCase('ja').includes(search)));
}
export function electionCandidates(catalog,electionId) {
  const election=catalog.elections.find(item=>item.id===electionId);
  if(election?.electionType!=='proportional')return catalog.candidates.filter(candidate=>candidate.electionId===electionId);
  const people=new Map(catalog.candidates.map(candidate=>[candidate.id,candidate]));
  return (catalog.proportionalCandidacies||[]).filter(entry=>entry.electionId===electionId).map(entry=>{
    const candidate=people.get(entry.candidateId);if(!candidate)return null;
    return {...candidate,electionId,originalElectionId:candidate.electionId,partyAtElection:entry.partyAtElection,candidacyId:entry.id,listedName:entry.listedName,listRank:entry.listRank,listOrder:entry.listOrder,dualCandidacy:entry.dualCandidacy,rankTied:entry.rankTied,candidacySourceIds:entry.sourceIds};
  }).filter(Boolean);
}
export function candidatePromises(catalog,candidate,theme='all') {
  const election=catalog.elections.find(item=>item.id===candidate.electionId);
  const matchesTheme=promise=>theme==='all'||promise.theme===theme;
  return {
    personal:catalog.promises.filter(promise=>promise.ownerType!=='party'&&promise.candidateId===candidate.id&&matchesTheme(promise)),
    party:catalog.promises.filter(promise=>promise.ownerType==='party'&&candidate.partyAtElection&&promise.partyName===candidate.partyAtElection&&election?.electionNumber&&promise.applicableElectionNumber===election.electionNumber&&matchesTheme(promise))
  };
}
export function validateCatalog(catalog) {
  const problems = [];
  for (const field of ['politicians','elections','candidates','promises','activities','support','sources']) if (!Array.isArray(catalog[field])) problems.push(`${field} must be an array`);
  if (problems.length) return problems;
  const sourceIDs = new Set(catalog.sources.map(source => source.id));
  if (sourceIDs.size !== catalog.sources.length) problems.push('Duplicate source IDs');
  for (const source of catalog.sources) if (!safeURL(source.url) && !catalog.meta?.isDemo) problems.push(`Invalid source URL: ${source.id}`);
  for (const field of ['politicians','elections','candidates','promises','activities','support',...(catalog.proportionalCandidacies?['proportionalCandidacies']:[])]) {
    const ids = new Set();
    for (const record of catalog[field]) {
      if (!record.id || ids.has(record.id)) problems.push(`Duplicate or empty ID: ${field}/${record.id}`);
      ids.add(record.id);
      if (!catalog.meta?.isDemo && (!record.sourceIds?.length || record.sourceIds.some(id => !sourceIDs.has(id)))) problems.push(`Missing evidence: ${field}/${record.id}`);
    }
  }
  const candidateIDs=new Set(catalog.candidates.map(candidate=>candidate.id)),electionByID=new Map(catalog.elections.map(election=>[election.id,election]));
  const entries=new Set();
  for(const entry of catalog.proportionalCandidacies||[]){
    if(!candidateIDs.has(entry.candidateId)||electionByID.get(entry.electionId)?.electionType!=='proportional')problems.push(`Invalid proportional candidacy reference: ${entry.id}`);
    const key=entry.electionId+'/'+entry.candidateId;
    if(entries.has(key))problems.push(`Duplicate proportional candidacy: ${key}`);
    entries.add(key);
    if(entry.listRank!==null&&entry.listRank!==undefined&&(!Number.isInteger(entry.listRank)||entry.listRank<1))problems.push(`Invalid list rank: ${entry.id}`);
    if(!entry.partyAtElection)problems.push(`Missing proportional party: ${entry.id}`);
    const candidate=catalog.candidates.find(person=>person.id===entry.candidateId);
    if(entry.dualCandidacy===true&&electionByID.get(candidate?.electionId)?.electionType==='proportional')problems.push(`Dual candidacy without constituency: ${entry.id}`);
    if(entry.dualCandidacy===false&&candidate?.electionId!==entry.electionId)problems.push(`Proportional-only candidacy uses a different election: ${entry.id}`);
  }
  for (const record of catalog.support) {
    for (const key of ['announcedAmountJPY','budgetAmountJPY','paidAmountJPY']) if (record[key] !== null && record[key] !== undefined && (!Number.isFinite(record[key]) || record[key] < 0)) problems.push(`Invalid amount: ${record.id}/${key}`);
    if (record.paidAmountJPY !== null && record.paidAmountJPY !== undefined && !record.paidScope) problems.push(`Missing payment scope: ${record.id}`);
    if (record.paidAmountIsDerived && !record.paidAmountMethod) problems.push(`Missing calculation method: ${record.id}`);
  }
  for (const person of catalog.politicians) if (person.naturalizationDisclosure && person.naturalizationDisclosure.selfPublished !== true) problems.push(`Naturalization disclosure must be self-published: ${person.id}`);
  for (const promise of catalog.promises) {
    if(promise.candidateId&&!candidateIDs.has(promise.candidateId))problems.push(`Invalid promise candidate reference: ${promise.id}`);
    if(promise.electionId&&!electionByID.has(promise.electionId))problems.push(`Invalid promise election reference: ${promise.id}`);
    if(promise.ownerType==='candidate'&&(!promise.candidateId||!promise.electionId))problems.push(`Missing personal promise owner: ${promise.id}`);
    if (promise.ownerType==='party'&&(!promise.partyName||promise.candidateId||promise.politicianId)) problems.push(`Invalid party promise ownership: ${promise.id}`);
    if (promise.progressEvidenceVerified===true) {
      if (!promise.progressSourceIds?.length||promise.progressSourceIds.some(id=>!sourceIDs.has(id))) problems.push(`Missing progress evidence: ${promise.id}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(promise.progressAsOf||'')||!promise.progressReason||!promise.progressScope) problems.push(`Missing progress scope or date: ${promise.id}`);
      if (promise.effectiveAt>promise.progressAsOf&&(promise.implementationStarted===true||['implemented','partially-implemented'].includes(promise.progressStage))) problems.push(`Future implementation marked complete: ${promise.id}`);
    }
  }
  for(const activity of catalog.activities){
    if(activity.candidateId&&!candidateIDs.has(activity.candidateId))problems.push(`Invalid activity candidate reference: ${activity.id}`);
    if(activity.promiseId&&!catalog.promises.some(p=>p.id===activity.promiseId))problems.push(`Invalid activity promise reference: ${activity.id}`);
  }
  return problems;
}
export function readPreferences(storage) {
  const defaults = {mode:'verified',large:false,followed:[],compare:{}};
  try { const saved=JSON.parse(storage.getItem('politics-window-v1') || '{}');return {...defaults,...saved,mode:saved.mode==='demo'?'demo':'verified',followed:Array.isArray(saved.followed)?saved.followed.filter(id=>typeof id==='string'):[],compare:saved.compare && typeof saved.compare==='object'&&!Array.isArray(saved.compare)?saved.compare:{}}; } catch { return defaults; }
}
