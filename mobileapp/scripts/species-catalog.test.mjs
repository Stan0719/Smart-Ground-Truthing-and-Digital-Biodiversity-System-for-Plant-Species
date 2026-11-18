import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
function load(file,deps){const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');const code=ts.transpileModule(source,{fileName:file+'.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('require','module','exports',code)((name)=>{if(name==='../components/BackButton')return{default:(props)=>React.createElement('TouchableOpacity',props,props.label||props.accessibilityLabel),__esModule:true};assert.ok(name in deps,name);return {...deps[name],__esModule:name!=='react'}},module,module.exports);return module.exports;}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(api){let slots=[],index=0,focus,active,removed=0;const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=value]},useMemo(fn,deps){const i=index++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={deps,value:fn()};return slots[i].value}};hooks.useCallback=(fn,deps)=>hooks.useMemo(()=>fn,deps);const module=load('utils/useSpeciesCatalog.js',{react:hooks,'@react-navigation/native':{useFocusEffect:fn=>focus=fn},'react-native':{AppState:{addEventListener:(_,fn)=>{active=fn;return{remove(){removed++}}}}},'./plantApi':api});return {render(account='owner',options={}){index=0;return module.useSpeciesCatalog(account,options)},focus:()=>focus(),active:()=>active('active'),removed:()=>removed};}

test('catalogue refreshes on focus, foreground and pull; counts include approved plants only',async()=>{let reads=0;const f=fixture({fetchSpeciesCatalog:async options=>{assert.equal(options.accountId,'owner');reads++;return [{id:'6'}]},fetchPlantRecords:async()=>[{speciesId:'6',currentStatus:'Approved'},{speciesId:'6',currentStatus:'Pending Review'}]});f.render();const cleanup=f.focus();await f.render().refresh();assert.equal(reads,1);assert.equal(f.render().counts['6'],1);f.active();await f.render().refresh();assert.equal(reads,2);cleanup();assert.equal(f.removed(),1);const again=f.focus();await f.render().refresh();assert.equal(reads,3);again();});

test('Guest and Visitor catalogue callers use public-only data and account changes clear prior catalogue state',async()=>{const reads=[];const f=fixture({fetchSpeciesCatalog:async options=>{reads.push(['species',options]);return[{id:'6'}]},fetchPlantRecords:async(_species,options)=>{reads.push(['plants',options]);return[{speciesId:'6',currentStatus:'Approved'}]}});f.render('visitor',{publicOnly:true});const visitorCleanup=f.focus();await f.render('visitor',{publicOnly:true}).refresh();assert.equal(f.render('visitor',{publicOnly:true}).counts['6'],1);assert.deepEqual(reads.map(([kind,options])=>[kind,options.accountId,options.publicOnly]),[['species','visitor',true],['plants','visitor',true]]);f.render(null,{publicOnly:true});assert.equal(f.render(null,{publicOnly:true}).species.length,0);const guestCleanup=f.focus();await f.render(null,{publicOnly:true}).refresh();assert.deepEqual(reads.slice(2).map(([kind,options])=>[kind,options.accountId,options.publicOnly]),[['species',null,true],['plants',null,true]]);visitorCleanup();guestCleanup();});

test('successful species are visible even if secondary plant counts fail; network errors retain them and auth clears them',async()=>{let failSpecies,failCounts=false;const f=fixture({fetchSpeciesCatalog:async()=>{if(failSpecies)throw failSpecies;return [{id:'6'}]},fetchPlantRecords:async()=>{if(failCounts)throw Error('Offline');return []}});f.render();const cleanup=f.focus();await f.render().refresh();failCounts=true;await f.render().refresh();assert.equal(f.render().species[0].id,'6');assert.equal(f.render().counts,null);assert.match(f.render().error,/counts/);failSpecies=Error('Network unavailable');await f.render().refresh();assert.equal(f.render().species[0].id,'6');assert.match(f.render().error,/Network/);failSpecies=Object.assign(Error('Session expired'),{status:401});await f.render().refresh();assert.equal(f.render().species.length,0);cleanup();});

test('late catalogue results cannot replace a newer focus visit and account changes hide old data',async()=>{let resolveOld,reads=0;const old=new Promise(r=>resolveOld=r);const f=fixture({fetchSpeciesCatalog:async()=>++reads===1?old:[{id:'fresh'}],fetchPlantRecords:async()=>[]});f.render();const first=f.focus();const pending=f.render().refresh();first();const second=f.focus();await f.render().refresh();resolveOld([{id:'stale'}]);await pending;assert.equal(f.render().species[0].id,'fresh');assert.equal(f.render('different').species.length,0);second();});

test('species search and sort retain records from every family',()=>{
  const source=readFileSync(new URL('../utils/speciesFilters.js',import.meta.url),'utf8').replace(/export /g,'');
  const context=vm.createContext({});vm.runInContext(`${source};this.filterAndSortSpecies=filterAndSortSpecies;this.getSpeciesFamilyOptions=getSpeciesFamilyOptions;this.resetMissingSpeciesFamily=resetMissingSpeciesFamily;`,context);
  const rows=[
    {id:'1',name:'Zed',scientificName:'Zeta one',family:'Zingiberaceae',description:'Ginger'},
    {id:'2',name:'Bean',scientificName:'Alpha bean',family:'Fabaceae',description:'Legume'},
    {id:'3',name:'Another bean',scientificName:'Beta bean',family:'Fabaceae',description:'Legume'},
    {id:'4',name:'No family',scientificName:'Unknown plant',family:'  ',description:''},
    {id:'5',name:'No family field',scientificName:'Unknown plant',description:''},
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows).map(row=>row.id))),['1','2','3','4','5']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{query:'beta'}).map(row=>row.id))),['3']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{query:'faba'}).map(row=>row.id))),['2','3']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{family:'Fabaceae'}).map(row=>row.id))),['2','3']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{sortOption:'name-asc'}).map(row=>row.name))),['Another bean','Bean','No family','No family field','Zed']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{sortOption:'name-desc'}).map(row=>row.name))),['Zed','No family field','No family','Bean','Another bean']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{sortOption:'scientific-asc'}).map(row=>row.scientificName))),['Alpha bean','Beta bean','Unknown plant','Unknown plant','Zeta one']);
  const labels=['en','ms','zh'].map(language=>JSON.parse(readFileSync(new URL(`../translations/${language}.json`,import.meta.url),'utf8')).common.all);
  assert.deepEqual(labels,['All','Semua','全部']);
});

test('species-specific Plants reloads are scoped to the selected route and API failures are not reported as zero plants',()=>{
  const list=readFileSync(new URL('../screens/Plant.js',import.meta.url),'utf8');
  const species=readFileSync(new URL('../screens/Species.js',import.meta.url),'utf8');
  const detail=readFileSync(new URL('../screens/SpeciesDetail.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../App.js',import.meta.url),'utf8');
  assert.match(app,/name="Plants"[\s\S]*?<SpeciesScreen[\s\S]*?name="Species"[\s\S]*?<PlantsScreen/);
  assert.match(app,/<PlantsStack\s+\{\.\.\.props\}\s+user=\{user\}/);
  assert.match(species,/navigation\.navigate\("Species",\s*\{\s*slug:\s*item\.slug,\s*speciesId:\s*pendingRequest \? item\.proposedSpeciesId : item\.id/);
  assert.match(detail,/slug:\s*selectedSpecies\.slug,\s*speciesId:\s*selectedSpecies\.id/);
  assert.match(list,/const requestKey = .*currentSpeciesId.*currentSlug/);
  assert.match(list,/activeRequest\?\.key === requestKey && activeRequest\.promise/);
  assert.match(list,/requestRef\.current\?\.id === requestId/);
  assert.match(list,/filterUniqueSpeciesPlantRecords\(records, matchedId, currentSlug\)/);
  assert.match(list,/filterPlantRecordsForRole\(recordsForSpecies, role, accountId, \{ publicOnly \}\)/);
  assert.match(list,/!loading && !refreshing && !errorMessage && <Text style=\{styles\.count\}>/);
  assert.match(list,/listViewState === "error" \? <View style=\{styles\.loadError\}/);
  assert.match(list,/listViewState === "loading" \? <View style=\{styles\.loadingState\}/);
  assert.match(list,/t\("common\.retry"\)/);
  assert.match(species,/useSpeciesCatalog\(user\?\.id, \{ publicOnly: isPublicViewer, includeOwnedRequests: isBotanist \}\)/);
  assert.match(list,/const publicOnly = !user \|\| isVisitor/);
  assert.doesNotMatch(list,/diagnostic|__DEV__/i);
  assert.match(list,/fetchPlantRecords\(catalog, \{ accountId, publicOnly \}\)/);
  assert.match(detail,/fetchPlantRecords\(\[\], \{ accountId: user\?\.id, publicOnly \}\)/);
});

test('a slower request for the previous species cannot replace the selected species plants',async()=>{
  let state=[],refs=[],stateIndex=0,refIndex=0,focus;
  let resolveFirst,resolveSecond,catalogReads=0;
  const firstCatalog=new Promise(resolve=>{resolveFirst=resolve});
  const secondCatalog=new Promise(resolve=>{resolveSecond=resolve});
  const hooks={
    useState(initial){const i=stateIndex++;if(!(i in state))state[i]=initial;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next}]},
    useRef(initial){const i=refIndex++;if(!(i in refs))refs[i]={current:initial};return refs[i]},
    useMemo(fn){return fn()},useCallback:fn=>fn,
  };
  const native={StyleSheet:{create:styles=>styles},Dimensions:{get:()=>({width:390})}};
  for(const name of ['View','Text','TextInput','TouchableOpacity','ScrollView','Image','RefreshControl'])native[name]=name;
  const screen=load('screens/Plant.js',{
    react:{...React,...hooks},'react-native':native,
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '@react-navigation/native':{useFocusEffect:fn=>{focus=fn}},
    '../translations/i18n':{t:key=>key,translateLabel:value=>value,translateUIMessage:value=>value,dateLocale:'en',useAppTranslation(){},translateFieldValue:value=>value},
    '../components/LanguageSelector':{default:'LanguageSelector'},'../data/mockData':{getSpeciesBySlug:()=>null},
    '../utils/plantApi':{
      fetchSpeciesCatalog:()=>++catalogReads===1?firstCatalog:secondCatalog,
      fetchPlantRecords:async()=>[
        {id:'8',plantId:'8',speciesId:'6',currentStatus:'Approved'},
        {id:'5',plantId:'5',speciesId:'5',currentStatus:'Approved'},
      ],
      filterUniqueSpeciesPlantRecords:(records,id,slug)=>records.filter(record=>id!=null?String(record.speciesId)===String(id):record.speciesSlug===slug),
      filterPlantRecordsForRole:(records,role,accountId,{publicOnly=false}={})=>publicOnly?records:records.filter(record=>record.currentStatus==='Approved'||(role==='Botanist'&&record.currentStatus==='Pending Review'&&record.registeredBy===`staff:${accountId}`)),
      getPlantDisplayObservation:()=>null,getScopedPlantRecords:(scoped,scope)=>scoped?.scope===scope&&Array.isArray(scoped.records)?scoped.records:[],isOwnedPendingPlant:()=>false,isPlantVisibleInRoleCatalog:plant=>plant.currentStatus==='Approved',mergeOwnedPendingPlantZones:records=>records,
    },
    '../utils/plantCardDisplay':{getPlantCardZoneLabel:()=>'',getPlantCardZoneValue:()=>null},
    '../components/RefreshButton':{default:'RefreshButton'},'../components/FavouriteHeart':{default:'FavouriteHeart'},
    '../hooks/useVisitorFavourites':{default:()=>({refresh:async()=>{},refreshing:false,loading:false,error:'',mutationError:'',isFavourite:()=>false,isPending:()=>false,toggle:async()=>{}})},
  });
  let screenTree;
  const render=(id,slug)=>{stateIndex=0;refIndex=0;screenTree=screen.default({route:{params:{speciesId:id,slug,species:{id,slug,name:`Species ${id}`}}},navigation:{navigate(){},goBack(){}},user:{id:'visitor',role:'Visitor'}});return refs[0].current.promise};
  render('5','species-5');
  focus();
  const previousRequest=refs[0].current.promise;
  render('6','species-6');
  focus();
  const selectedRequest=refs[0].current.promise;
  assert.notEqual(selectedRequest,previousRequest,'route changes start a request for the selected species');
  resolveFirst([{id:'5',slug:'species-5',name:'Species 5'}]);
  resolveSecond([{id:'6',slug:'species-6',name:'Species 6'}]);
  await Promise.all([previousRequest,selectedRequest]);
  assert.deepEqual(state[1].records.map(plant=>plant.plantId),['8']);
  render('6','species-6');
  assert.equal(screenTree.type,'SafeAreaView');
  assert.deepEqual(screenTree.props.edges,['top','left','right']);
  const [header,scroll]=React.Children.toArray(screenTree.props.children);
  assert.equal(header.type,'View');
  assert.equal(screenTree.props.style.backgroundColor,header.props.style.backgroundColor,'safe area behind the status bar matches the light-green fixed header');
  assert.equal(screenTree.props.style.backgroundColor,'#E7F2E2');
  assert.equal(header.props.style.paddingTop,8,'safe area replaces the fixed 50-point top gap');
  assert.equal(scroll.type,'ScrollView');
  assert.equal(scroll.props.style.backgroundColor,'#F7FBF4','scrolling content retains its existing background');
  const nodes=node=>node&&typeof node==='object'?[node,...React.Children.toArray(node.props?.children).flatMap(nodes)]:[];
  const headerNodes=nodes(header),scrollNodes=nodes(scroll);
  assert.equal(headerNodes.filter(node=>node.type==='RefreshButton').length,1);
  assert.equal(scrollNodes.some(node=>node.type==='RefreshButton'),false);
  assert.equal(headerNodes.some(node=>node.type==='TextInput'),false);
  assert.equal(scrollNodes.filter(node=>node.type==='TextInput').length,1,'search remains in scrolling content');
  assert.ok(headerNodes.some(node=>node.props?.children==='plant.allVisiblePlants'));
  const refresh=headerNodes.find(node=>node.type==='RefreshButton');
  assert.equal(refresh.props.testID,'plant-list-refresh');
  refresh.props.onPress();
  await refs[0].current.promise;
  render('6','species-6');
  assert.equal(React.Children.toArray(screenTree.props.children)[0].type,'View','header stays outside scroll after refresh');

});

test('actual catalogue renders an approved species and both refresh actions', () => {
  const navigations = [];
  let refreshes = 0;
  const native = { StyleSheet: { create: x => x }, Dimensions: { get: () => ({ width: 390 }) } };
  for (const type of ['View', 'Text', 'TextInput', 'TouchableOpacity', 'FlatList', 'ScrollView', 'Image']) native[type] = type;
  const screen = load('screens/Species.js', {
    react: { ...React, useState: initial => [initial, () => {}], useMemo: fn => fn(), useCallback: fn => fn, useEffect() {} },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../translations/i18n': { t: v => v, useAppTranslation() {}, translateLabel: v => v, translateUIMessage: v => v },
    '../components/LanguageSelector': { default: 'LanguageSelector' },
    '../components/RefreshButton': { default: 'RefreshButton' },
    '../components/FavouriteHeart': { default: 'FavouriteHeart' },
    '../data/speciesImages': { getSpeciesImageSource: species => species.image },
    '../hooks/useVisitorFavourites': { default: () => ({ isFavourite: () => false, isPending: () => false, loading: false, refreshing: false, mutationError: '', error: '', refresh: async () => {}, toggle: async () => {} }) },
    '../utils/speciesFilters': { combineBotanistSpecies: (species, requests) => [...species, ...(requests || [])], filterAndSortSpecies: species => species, getSpeciesFamilyOptions: species => [...new Set(species.map(item => item.family).filter(Boolean))], resetMissingSpeciesFamily: (family, options) => family !== null && !options.includes(family) ? null : family },
    '../utils/useSpeciesCatalog': { useSpeciesCatalog: (id, options) => {
      assert.ok(id === 'owner' || id == null);
      const approved = { id: '6', slug: 'api-species-6', name: 'Actual common name', scientificName: 'Actual approved species', approvalStatus: 'Approved', genus: 'Actual genus', family: 'Fabaceae', conservationStatus: 'Not Assessed', description: 'Actual description', image: { uri: 'https://example.invalid/api/assets/real-upload', headers: { Authorization: 'Bearer fixture' } } };
      return { species: options.publicOnly ? [approved, { id: '7', slug: 'pending', approvalStatus: 'Pending Review' }, { id: '8', slug: 'rejected', approvalStatus: 'Rejected' }, { id: 'request:9', slug: 'private', privateRequest: true, approvalStatus: 'Approved' }] : [approved], ownedRequests: [], counts: {}, loading: false, error: '', refresh() { refreshes++; } };
    } },
  });
  const tree = screen.default({ user: { id: 'owner', role: 'botanist' }, navigation: { navigate: (...args) => navigations.push(args) } });
  const catalogueSource = readFileSync(new URL('../screens/Species.js', import.meta.url), 'utf8');
  assert.match(catalogueSource, /!isBotanist && !isPublicViewer && <FlatList/);
  assert.doesNotMatch(catalogueSource, /setActiveCategory/);
  const [header, list] = React.Children.toArray(tree.props.children);
  assert.equal(header.type, 'View');
  assert.equal(list.type, 'FlatList');
  assert.equal(list.props.style.flex, 1, 'only the results list occupies the remaining scroll area');
  assert.equal(list.props.ListHeaderComponent, undefined, 'controls remain outside the scrolling list');
  assert.ok(list.props.contentContainerStyle.paddingBottom > 0, 'last card clears the bottom tabs');
  assert.equal(list.props.data.length, 1);
  assert.equal(list.props.data[0].id, '6');
  assert.doesNotMatch(readFileSync(new URL('../screens/Species.js', import.meta.url), 'utf8'), /const categories\s*=|item\.category/);
  const walk = n => !n || typeof n !== 'object' ? [] : typeof n.type === 'function' ? walk(n.type(n.props)) : [n, ...React.Children.toArray(n.props?.children).flatMap(walk)];
  const children = n => React.Children.toArray(n?.props?.children);
  assert.equal(walk(header).filter(n => n.type === 'FlatList' && n.props.horizontal).length, 0);
  const visitorTree = screen.default({ user: { id: 'owner', role: 'visitor' }, navigation: { navigate: (...args) => navigations.push(args) } });
  const [visitorHeader, visitorList] = React.Children.toArray(visitorTree.props.children);
  assert.deepEqual(visitorList.props.data.map(item => item.id), ['6'], 'public search, sort and refresh operate on approved records only');
  assert.equal(walk(visitorHeader).filter(n => n.type === 'FlatList' && n.props.horizontal).length, 0);
  const guestTree = screen.default({ user: null, navigation: { navigate: (...args) => navigations.push(args) } });
  const [guestHeader, guestList] = React.Children.toArray(guestTree.props.children);
  assert.deepEqual(guestList.props.data.map(item => item.id), ['6']);
  assert.equal(walk(guestHeader).filter(n => n.type === 'FlatList' && n.props.horizontal).length, 0);
  for (const role of ['Officer', 'Admin']) {
    const roleTree = screen.default({ user: { id: 'owner', role }, navigation: { navigate: (...args) => navigations.push(args) } });
    const [roleHeader, roleList] = React.Children.toArray(roleTree.props.children);
    assert.equal(walk(roleHeader).filter(n => n.type === 'FlatList' && n.props.horizontal).length, 1, `${role} Family control stays fixed`);
    assert.equal(walk(roleList.props.renderItem({ item: roleList.props.data[0] })).filter(n => n.props?.children === 'Approved').length, 1, `${role} badge remains`);
  }
  for (const publicList of [visitorList, guestList]) {
    const publicCard = publicList.props.renderItem({ item: publicList.props.data[0] });
    assert.equal(walk(publicCard).filter(n => n.props?.children === 'Approved').length, 0, 'public cards omit approval badges');
    assert.ok(walk(publicCard).some(n => children(n).includes('species.family')), 'family information remains in the card');
    const publicActions = walk(publicCard).filter(n => n.type === 'TouchableOpacity');
    publicActions[0].props.onPress();
    assert.equal(navigations.at(-1)[0], 'SpeciesDetail');
  }
  navigations.length = 0;
  const controls = walk(header).find(n => n.type === 'View' && children(n).map(child => child.type).join(',') === 'TextInput,RefreshButton,TouchableOpacity');
  assert.ok(controls, 'search, refresh and Filters share the first row');
  assert.equal(walk(header).filter(n => n.type === 'ScrollView' && n.props.horizontal).length, 1);
  assert.ok(walk(header).some(n => n.type === 'LanguageSelector'));
  assert.equal(walk(header).filter(n => n.type === 'RefreshButton' && n.props.testID === 'catalogue-species-refresh').length, 1);
  list.props.onRefresh();
  assert.equal(refreshes, 1);
  const button = walk(header).find(n => n.type === 'RefreshButton' && n.props.testID === 'catalogue-species-refresh');
  assert.ok(button);
  button.props.onPress();
  assert.equal(refreshes, 2);
  const card = list.props.renderItem({ item: list.props.data[0] });
  for (const value of ['Actual approved species', 'Actual common name', 'Actual genus', 'Fabaceae']) {
    assert.ok(walk(card).some(n => children(n).includes(value)), `${value} remains on the card`);
  }
  assert.equal(walk(card).some(n => children(n).includes('Not Assessed')), false, 'conservation status stays in Species Details');
  assert.equal(walk(card).some(n => children(n).includes('Actual description')), false, 'long description remains in Species Details');
  const picture = walk(card).find(n => n.type === 'Image');
  assert.equal(picture.props.source.uri, 'https://example.invalid/api/assets/real-upload');
  assert.equal(picture.props.source.headers.Authorization, 'Bearer fixture');
  const actions = walk(card).filter(n => n.type === 'TouchableOpacity');
  actions[0].props.onPress();
  actions[1].props.onPress();
  assert.equal(navigations[0][0], 'SpeciesDetail');
  assert.equal(navigations[0][1].speciesId, '6');
  assert.equal(navigations[1][0], 'Species');
  assert.equal(navigations[1][1].speciesId, '6');
  const pendingCard = list.props.renderItem({ item: { id: 'request:12', requestId: '12', proposedSpeciesId: '8', slug: 'species-request-12',
    privateRequest: true, name: 'Own request', scientificName: 'Example species', family: 'Fabaceae',
    approvalStatus: 'Pending Review', description: 'Submitted description' } });
  const pendingActions = walk(pendingCard).filter(n => n.type === 'TouchableOpacity');
  assert.equal(pendingActions.length, 2, 'owner pending requests reuse both catalogue actions');
  pendingActions[0].props.onPress();
  assert.equal(navigations[2][0], 'SpeciesDetail');
  assert.equal(navigations[2][1].requestId, '12');
  pendingActions[1].props.onPress();
  assert.equal(navigations[3][0], 'Species');
  assert.equal(navigations[3][1].speciesId, '8');
});
