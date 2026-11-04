class PlantContactMonitor:
    """Debounce image-space wrist overlap for each tracked person/plant pair."""

    def __init__(self, hold_seconds=0.6, min_frames=3, max_gap_seconds=1.5):
        self.hold_seconds = hold_seconds
        self.min_frames = min_frames
        self.max_gap_seconds = max_gap_seconds
        self.pending = {}

    def update(self, people, plants, now):
        # Inputs contain only confident wrists and objects with stable tracker IDs.
        current = {}
        contacts = set()
        for person_id, wrists in people:
            for plant_id, (x1, y1, x2, y2) in plants:
                if not any(x1 <= x <= x2 and y1 <= y <= y2 for x, y in wrists):
                    continue
                pair = (person_id, plant_id)
                start, last_seen, frames = self.pending.get(pair, (now, now, 0))
                if now - last_seen > self.max_gap_seconds:
                    start, frames = now, 0
                frames += 1
                current[pair] = (start, now, frames)
                if frames >= self.min_frames and now - start >= self.hold_seconds:
                    contacts.add(pair)
        self.pending = current
        return contacts
