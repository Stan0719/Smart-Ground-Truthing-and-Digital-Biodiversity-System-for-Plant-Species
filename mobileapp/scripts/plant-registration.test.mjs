import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function context() {
  const c = vm.createContext({});
  for (const file of ['plantApi.js', 'botanistRecords.js']) {
    const source = readFileSync(new URL(`../utils/${file}`, import.meta.url), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    vm.runInContext(source, c);
  }
  return c;
}
const response = {
  plant_id:30, species_id:19, scientific_name:'Fixture Plant', rbac_status:'Approved', registered_subject:'staff:owner',
  latitude:1.532192, longitude:110.357739, plant_image_asset_id:'registration-photo-1',
  current_registration:{ state:'available',observation_id:'registration-A',photo_ids:['registration-photo-1','registration-photo-2','registration-photo-3'],
    content:{heightCm:30,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Registered morphology'} },
  latest_approved:{heightCm:10,healthStatus:'Healthy',lifeStage:'seedling',latitude:37.4219983,longitude:-122.084},
  latest_verified_observation:{id:'visit-B',status:'Approved',content:{heightCm:10,lifeStage:'seedling'},photo_ids:[]},
};

test('cards, main details and map retain registration A while verified Observation B stays separate', () => {
  const c = context(); c.response = response;
  const plant = vm.runInContext('mapBackendPlant(response)', c);
  const facts = c.getPlantDisplayObservation(plant);
  assert.equal(facts.heightCm,30); assert.equal(facts.lifeStage,'Mature');
  assert.equal(plant.latestApproved.heightCm,10);
  assert.equal(plant.latestVerifiedObservation.id,'visit-B');
  assert.equal(plant.location.latitude,1.532192); assert.equal(plant.location.longitude,110.357739);
  assert.equal(plant.plantImageAssetId,'registration-photo-1');
  assert.equal(plant.registrationPhotoIds.length,3);
  assert.equal(plant.latestVerifiedObservation.photo_ids.length,0);
  for (const screen of ['Plant.js','PlantDetail.js','SpeciesDetail.js']) {
    const source = readFileSync(new URL(`../screens/${screen}`,import.meta.url),'utf8');
    // Embedded species summaries may delegate to the same Plant card helper.
    if (screen !== 'SpeciesDetail.js') assert.match(source,/getPlantDisplayObservation/);
  }
  const scan = readFileSync(new URL('../screens/Scan.js',import.meta.url),'utf8');
  assert.match(scan,/navigate\("PlantDetails", \{ plantId:/);
});

test('Dashboard keeps registration measurements and photo IDs even when a newer owned Observation exists', () => {
  const c = context();
  const result = c.projectBotanistRecords('owner',[response],[
    {id:'visit-B',plant_id:30,owner_subject:'staff:owner',status:'Approved',created_at:'2026-11-17',content:response.latest_approved,assets:[]},
  ],[]).plants[0];
  assert.equal(result.height,30); assert.equal(result.growthStage,'Mature');
  assert.equal(result.latestObservation.id,'visit-B');
  assert.equal(result.registrationPhotoIds.length,3);
});

test('unavailable registration never falls back to an unrelated approved Observation', () => {
  const c = context();
  const mapped = c.mapBackendPlant({...response,current_registration:{state:'unavailable'},latitude:null,longitude:null,plant_image_asset_id:null});
  assert.equal(mapped.registrationState,'unavailable');
  assert.equal(c.getPlantDisplayObservation(mapped),null);
  assert.equal(mapped.location.latitude,null);
  assert.equal(mapped.plantImageAssetId,null);
});

test('GPS-free Observation remains absent rather than inheriting registration coordinates', () => {
  const c = context();
  const observed = c.mapBackendObservation({id:'visit-C',plant_id:30,status:'Approved',content:{heightCm:12},assets:[]});
  assert.equal(observed.latitude,null); assert.equal(observed.longitude,null);
  assert.equal(observed.photos.length,0);
});
