import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
function load(file,deps){const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');const code=ts.transpileModule(source,{fileName:file+'.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('require','module','exports',code)((name)=>{assert.ok(name in deps,name);return {...deps[name],__esModule:name!=='react'}},module,module.exports);return module.exports;}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(api){let slots=[],index=0,focus,active,removed=0;const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=value]},useMemo(fn,deps){const i=index++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={deps,value:fn()};return slots[i].value}};hooks.useCallback=(fn,deps)=>hooks.useMemo(()=>fn,deps);const module=load('utils/useSpeciesCatalog.js',{react:hooks,'@react-navigation/native':{useFocusEffect:fn=>focus=fn},'react-native':{AppState:{addEventListener:(_,fn)=>{active=fn;return{remove(){removed++}}}}},'./plantApi':api});return {render(account='owner'){index=0;return module.useSpeciesCatalog(account)},focus:()=>focus(),active:()=>active('active'),removed:()=>removed};}

test('catalogue refreshes on focus, foreground and pull; counts include approved plants only',async()=>{let reads=0;const f=fixture({fetchSpeciesCatalog:async options=>{assert.equal(options.accountId,'owner');reads++;return [{id:'6'}]},fetchPlantRecords:async()=>[{speciesId:'6',currentStatus:'Approved'},{speciesId:'6',currentStatus:'Pending Review'}]});f.render();const cleanup=f.focus();await f.render().refresh();assert.equal(reads,1);assert.equal(f.render().counts['6'],1);f.active();await f.render().refresh();assert.equal(reads,2);cleanup();assert.equal(f.removed(),1);const again=f.focus();await f.render().refresh();assert.equal(reads,3);again();});

test('successful species are visible even if secondary plant counts fail; network errors retain them and auth clears them',async()=>{let failSpecies,failCounts=false;const f=fixture({fetchSpeciesCatalog:async()=>{if(failSpecies)throw failSpecies;return [{id:'6'}]},fetchPlantRecords:async()=>{if(failCounts)throw Error('Offline');return []}});f.render();const cleanup=f.focus();await f.render().refresh();failCounts=true;await f.render().refresh();assert.equal(f.render().species[0].id,'6');assert.equal(f.render().counts,null);assert.match(f.render().error,/counts/);failSpecies=Error('Network unavailable');await f.render().refresh();assert.equal(f.render().species[0].id,'6');assert.match(f.render().error,/Network/);failSpecies=Object.assign(Error('Session expired'),{status:401});await f.render().refresh();assert.equal(f.render().species.length,0);cleanup();});

test('late catalogue results cannot replace a newer focus visit and account changes hide old data',async()=>{let resolveOld,reads=0;const old=new Promise(r=>resolveOld=r);const f=fixture({fetchSpeciesCatalog:async()=>++reads===1?old:[{id:'fresh'}],fetchPlantRecords:async()=>[]});f.render();const first=f.focus();const pending=f.render().refresh();first();const second=f.focus();await f.render().refresh();resolveOld([{id:'stale'}]);await pending;assert.equal(f.render().species[0].id,'fresh');assert.equal(f.render('different').species.length,0);second();});

test('family filter options are derived from backend species, deduplicated, sorted, and omit empty values',()=>{
  const source=readFileSync(new URL('../utils/speciesFilters.js',import.meta.url),'utf8').replace(/export /g,'');
  const context=vm.createContext({});vm.runInContext(`${source};this.getSpeciesFamilyOptions=getSpeciesFamilyOptions;this.filterAndSortSpecies=filterAndSortSpecies;this.resetMissingSpeciesFamily=resetMissingSpeciesFamily;`,context);
  const rows=[
    {id:'1',name:'Zed',scientificName:'Zeta one',family:'Zingiberaceae',description:'Ginger'},
    {id:'2',name:'Bean',scientificName:'Alpha bean',family:'Fabaceae',description:'Legume'},
    {id:'3',name:'Another bean',scientificName:'Beta bean',family:'Fabaceae',description:'Legume'},
    {id:'4',name:'No family',scientificName:'Unknown plant',family:'  ',description:''},
    {id:'5',name:'No family field',scientificName:'Unknown plant',description:''},
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(context.getSpeciesFamilyOptions(rows))),['Fabaceae','Zingiberaceae']);
  assert.equal(context.getSpeciesFamilyOptions([]).length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{family:'Fabaceae'}).map(row=>row.id))),['2','3']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{family:'Fabaceae',query:'beta'}).map(row=>row.id))),['3']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{sortOption:'name-asc'}).map(row=>row.name))),['Another bean','Bean','No family','No family field','Zed']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{sortOption:'name-desc'}).map(row=>row.name))),['Zed','No family field','No family','Bean','Another bean']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.filterAndSortSpecies(rows,{sortOption:'scientific-asc'}).map(row=>row.scientificName))),['Alpha bean','Beta bean','Unknown plant','Unknown plant','Zeta one']);
  const refreshed=[{id:'6',family:'Orchidaceae'}];
  const refreshedOptions=JSON.parse(JSON.stringify(context.getSpeciesFamilyOptions(refreshed)));
  assert.deepEqual(refreshedOptions,['Orchidaceae']);
  assert.equal(context.resetMissingSpeciesFamily('Fabaceae',refreshedOptions),null);
  assert.equal(context.resetMissingSpeciesFamily('Orchidaceae',refreshedOptions),'Orchidaceae');
  const labels=['en','ms','zh'].map(language=>JSON.parse(readFileSync(new URL(`../translations/${language}.json`,import.meta.url),'utf8')).common.all);
  assert.deepEqual(labels,['All','Semua','全部']);
});

test('actual catalogue renders an approved species and both refresh actions', () => {
  const navigations = [];
  let refreshes = 0;
  const native = { StyleSheet: { create: x => x }, Dimensions: { get: () => ({ width: 390 }) } };
  for (const type of ['View', 'Text', 'TextInput', 'TouchableOpacity', 'FlatList', 'Image']) native[type] = type;
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
    '../utils/speciesFilters': { filterAndSortSpecies: (species, options) => species, getSpeciesFamilyOptions: species => [...new Set(species.map(item => item.family).filter(Boolean))], resetMissingSpeciesFamily: (family, options) => family !== null && !options.includes(family) ? null : family },
    '../utils/useSpeciesCatalog': { useSpeciesCatalog: id => {
      assert.equal(id, 'owner');
      return { species: [{ id: '6', slug: 'api-species-6', name: 'Actual common name', scientificName: 'Actual approved species', family: 'Fabaceae', description: 'Actual description', image: { uri: 'https://example.invalid/api/assets/real-upload', headers: { Authorization: 'Bearer fixture' } } }], counts: {}, loading: false, error: '', refresh() { refreshes++; } };
    } },
  });
  const tree = screen.default({ user: { id: 'owner', role: 'botanist' }, navigation: { navigate: (...args) => navigations.push(args) } });
  const list = React.Children.toArray(tree.props.children)[0];
  assert.equal(list.props.data.length, 1);
  assert.equal(list.props.data[0].id, '6');
  assert.doesNotMatch(readFileSync(new URL('../screens/Species.js', import.meta.url), 'utf8'), /const categories\s*=|item\.category/);
  const walk = n => !n || typeof n !== 'object' ? [] : [n, ...React.Children.toArray(n.props?.children).flatMap(walk)];
  const familyFilter = walk(list.props.ListHeaderComponent).find(n => n.type === 'FlatList' && n.props.horizontal);
  assert.deepEqual(familyFilter.props.data, [null, 'Fabaceae']);
  assert.equal(familyFilter.props.keyExtractor('Fabaceae'), 'Fabaceae');
  list.props.onRefresh();
  assert.equal(refreshes, 1);
  const button = walk(list.props.ListHeaderComponent).find(n => n.type === 'RefreshButton' && n.props.testID === 'catalogue-species-refresh');
  assert.ok(button);
  button.props.onPress();
  assert.equal(refreshes, 2);
  const card = list.props.renderItem({ item: list.props.data[0] });
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
});
