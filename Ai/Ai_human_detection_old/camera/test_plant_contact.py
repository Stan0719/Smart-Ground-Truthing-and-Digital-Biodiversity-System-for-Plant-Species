import unittest

from plant_contact import PlantContactMonitor


class PlantContactTests(unittest.TestCase):
    def setUp(self):
        self.monitor = PlantContactMonitor()
        self.plants = [(7, (100, 100, 200, 200))]
        self.people = [(1, [(150, 150)])]

    def test_requires_both_duration_and_repeated_frames(self):
        self.assertEqual(self.monitor.update(self.people, self.plants, 0), set())
        self.assertEqual(self.monitor.update(self.people, self.plants, 0.2), set())
        self.assertEqual(self.monitor.update(self.people, self.plants, 0.4), set())
        self.assertEqual(self.monitor.update(self.people, self.plants, 0.7), {(1, 7)})

    def test_missing_wrist_or_plant_resets_contact(self):
        for people, plants in [([], self.plants), (self.people, []),
                               ([(1, [])], self.plants),
                               ([(1, [(250, 150)])], self.plants)]:
            with self.subTest(people=people, plants=plants):
                self.monitor.update(self.people, self.plants, 0)
                self.monitor.update(self.people, self.plants, 0.3)
                self.assertEqual(self.monitor.update(people, plants, 0.7), set())
                self.assertEqual(self.monitor.update(self.people, self.plants, 0.8), set())

    def test_people_and_plants_do_not_share_contact_timers(self):
        self.monitor.update(self.people, self.plants, 0)
        self.monitor.update(self.people, self.plants, 0.3)
        people = [(2, [(150, 150)])]
        self.assertEqual(self.monitor.update(people, self.plants, 0.7), set())
        self.monitor.update(people, self.plants, 1.0)
        self.assertEqual(self.monitor.update(people, self.plants, 1.4), {(2, 7)})
        self.assertEqual(self.monitor.update(people, [(8, (100, 100, 200, 200))], 1.5), set())

    def test_long_processing_gap_resets_timer(self):
        self.monitor.update(self.people, self.plants, 0)
        self.monitor.update(self.people, self.plants, 0.3)
        self.assertEqual(self.monitor.update(self.people, self.plants, 3), set())


if __name__ == "__main__":
    unittest.main()
