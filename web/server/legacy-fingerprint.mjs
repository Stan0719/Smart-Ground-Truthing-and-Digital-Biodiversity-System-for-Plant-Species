// Compare stored geometry bytes rather than version-specific PostGIS JSON casts.
export function sourceFingerprintSql(table){
 if(!/^[a-z_]+$/.test(table))throw Error('Unexpected source table name.')
 const payload=table==='plant_location'?"(to_jsonb(t)-'geometry')||jsonb_build_object('geometry',t.geometry::text)":"to_jsonb(t)"
 return `SELECT count(*)::int AS count,md5(coalesce(string_agg(payload,chr(10) ORDER BY payload),'')) AS digest FROM (SELECT (${payload})::text AS payload FROM public."${table}" t) q`
}
