const validPlantId = (value) =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647;

function publicPlantPageOptions(query, allowed) {
  if (query.page_size === undefined) return null;
  const { species_id: speciesId, before_plant_id: before = null, page_size: rawLimit } = query;
  const limit = Number(rawLimit);
  if (!allowed || !validPlantId(speciesId) || (before !== null && !validPlantId(before)) ||
    typeof rawLimit !== "string" || !/^\d{1,2}$/.test(rawLimit) || limit < 1 || limit > 50) {
    throw Object.assign(Error("Invalid public plant page."), { status: 400 });
  }
  return { speciesId, before, limit };
}

function publicPlantPageMetadata(rows, limit) {
  const hasMore = rows.length > limit;
  return {
    limit,
    has_more: hasMore,
    next_cursor: hasMore ? String(rows[limit - 1].plant_id) : null,
  };
}

async function readPlantSpeciesCounts(pool, visibleSpecies, scientific) {
  // The catalogue's owner exceptions only apply to pending rows.
  const { rows } = await pool.query(
    `SELECT p.species_id, count(*)::integer AS count
     FROM plant_record p JOIN species s ON s.species_id=p.species_id
     LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
     WHERE p.rbac_status='Approved'
       AND COALESCE(v.visibility,'protected') = ANY($1::text[])
       AND ($2::boolean OR COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved')
     GROUP BY p.species_id`,
    [visibleSpecies, scientific],
  );
  return rows;
}

module.exports = { publicPlantPageOptions, publicPlantPageMetadata, readPlantSpeciesCounts };
