import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import torch

from camera import cam


class PlantContactTests(unittest.TestCase):
    def test_recording_scales_frames_and_limits_rate_without_speeding_up_time(self):
        writer = MagicMock()
        recorder = cam.EventVideoWriter(writer, 8, (640, 360))
        frame = np.zeros((540, 960, 3), dtype=np.uint8)
        recorder.write(frame, 0)
        recorder.write(frame, 0.02)
        self.assertEqual(writer.write.call_count, 1)
        recorder.write(frame, 1)
        self.assertEqual(writer.write.call_count, 9)
        for call in writer.write.call_args_list:
            self.assertEqual(call.args[0].shape, (360, 640, 3))
        recorder.release()
        writer.release.assert_called_once()

    def test_fixed_region_ignores_detector_dropouts_and_neighboring_plants(self):
        region = cam.FixedPlantRegion()
        region.on_mouse(cam.cv2.EVENT_LBUTTONDOWN, 200, 200, None, None)
        region.on_mouse(cam.cv2.EVENT_MOUSEMOVE, 100, 100, None, None)
        region.on_mouse(cam.cv2.EVENT_LBUTTONUP, 100, 100, None, None)
        self.assertEqual(region.bounds, (100, 100, 200, 200))
        self.assertEqual(region.monitoring_regions([]), [(-1, region.bounds)])
        neighbor = [(5, (300, 300, 400, 400))]
        self.assertEqual(region.monitoring_regions(neighbor), [(-1, region.bounds)])
        region.select(None)
        self.assertEqual(region.monitoring_regions(neighbor), neighbor)

    def test_small_drag_and_sidebar_click_do_not_select_region(self):
        region = cam.FixedPlantRegion()
        region.on_mouse(cam.cv2.EVENT_LBUTTONDOWN, 100, 100, None, None)
        region.on_mouse(cam.cv2.EVENT_LBUTTONUP, 105, 105, None, None)
        self.assertIsNone(region.bounds)
        region.on_mouse(cam.cv2.EVENT_LBUTTONDOWN, 1100, 100, None, None)
        region.on_mouse(cam.cv2.EVENT_LBUTTONUP, 1100, 300, None, None)
        self.assertIsNone(region.bounds)

    def test_two_seconds_required(self):
        monitor = cam.PlantContactMonitor()
        plants, wrists = [(1, (100, 100, 200, 200))], [(150, 150)]
        self.assertEqual(monitor.update(plants, wrists, 10)[0], set())
        self.assertEqual(monitor.update(plants, wrists, 11.99)[0], set())
        self.assertEqual(monitor.update(plants, wrists, 12)[0], {1})

    def test_leaving_or_missing_plant_resets_timer(self):
        for plants, wrists in (([], [(150, 150)]), ([(1, (100, 100, 200, 200))], [])):
            monitor = cam.PlantContactMonitor()
            monitor.update([(1, (100, 100, 200, 200))], [(150, 150)], 0)
            monitor.update(plants, wrists, 6)
            self.assertEqual(monitor.update([(1, (100, 100, 200, 200))], [(150, 150)], 7)[0], set())

    def test_different_plants_do_not_share_time(self):
        monitor = cam.PlantContactMonitor()
        plants = [(1, (100, 100, 200, 200)), (2, (300, 300, 400, 400))]
        monitor.update(plants, [(150, 150)], 0)
        self.assertEqual(monitor.update(plants, [(350, 350)], 7)[0], set())

    def test_camera_requires_two_seconds_and_movement_of_the_contacted_plant(self):
        cases = [(near, movement, False, True) for near, movement in
                 ((True, set()), (True, {1}), (False, {1}), (False, set()), (True, {2}))]
        cases += [(True, {-1}, True, False), (True, set(), True, False),
                  (True, {1}, True, True), (False, {-1}, True, False)]
        for wrist_near, moving, fixed, detected in cases:
            with self.subTest(wrist_near=wrist_near, moving=moving, fixed=fixed, detected=detected):
                frame = np.zeros((540, 960, 3), dtype=np.uint8)
                capture = MagicMock()
                capture.isOpened.return_value = True
                capture.read.return_value = (True, frame)
                box = SimpleNamespace(cls=torch.tensor([0]), id=torch.tensor([1]),
                                      xyxy=torch.tensor([[100, 100, 200, 200]]))
                detector, plant_model, pose_model = MagicMock(), MagicMock(), MagicMock()
                detector.names = {0: 'person'}
                detector.track.return_value = [SimpleNamespace(boxes=[box])]
                plant_model.track.return_value = [SimpleNamespace(boxes=[box] if detected else [])]
                region = cam.FixedPlantRegion()
                if fixed:
                    region.select((100, 100, 200, 200))
                points = torch.zeros((1, 17, 3))
                points[0, 9] = torch.tensor([150 if wrist_near else 400, 150, 0.9])
                pose_model.predict.return_value = [SimpleNamespace(keypoints=SimpleNamespace(data=points))]
                writer = MagicMock()
                sound = MagicMock()
                with patch.multiple(cam.cv2, VideoCapture=MagicMock(return_value=capture),
                                    VideoWriter=MagicMock(return_value=writer), namedWindow=MagicMock(),
                                    setMouseCallback=MagicMock(),
                                    imshow=MagicMock(), destroyAllWindows=MagicMock(),
                                    waitKey=MagicMock(side_effect=[-1, -1, ord('q')])), \
                        patch.object(cam, 'YOLO', side_effect=[detector, pose_model]), \
                        patch.object(cam, 'YOLOWorld', return_value=plant_model), \
                        patch.object(cam, 'FixedPlantRegion', return_value=region), \
                        patch.object(cam.time, 'monotonic', side_effect=[0, 1.9, 2]), \
                        patch.object(cam.PlantMotionMonitor, 'update', return_value=moving), \
                        patch.object(cam, 'put_text', wraps=cam.put_text) as text, \
                        patch.object(cam, 'winsound', sound):
                    cam.main()
                should_alert = wrist_near and (-1 if fixed else 1) in moving
                self.assertEqual(writer.write.call_count, 1 if should_alert else 0)
                self.assertEqual(sound.Beep.call_count, 1 if should_alert else 0)
                handling_labels = [call.args[1] for call in text.call_args_list
                                   if call.args[1].startswith('POSSIBLE HANDLING:')]
                self.assertEqual(bool(handling_labels), should_alert)
                capture.release.assert_called_once()
                self.assertEqual(plant_model.track.call_count, 3)

    def test_optical_flow_detects_plant_motion_but_rejects_camera_translation(self):
        rng = np.random.default_rng(42)
        frame = rng.integers(0, 256, (300, 400, 3), dtype=np.uint8)
        frame = cam.cv2.GaussianBlur(frame, (5, 5), 0)
        plants = [(1, (100, 80, 240, 220))]
        moved = frame.copy()
        moved[80:220, 100:240] = np.roll(frame[80:220, 100:240], 5, axis=1)
        monitor = cam.PlantMotionMonitor()
        self.assertEqual(monitor.update(frame, plants, [], []), set())
        self.assertEqual(monitor.update(moved, plants, [], []), {1})
        camera_moved = cam.cv2.warpAffine(frame, np.float32([[1, 0, 5], [0, 1, 0]]), (400, 300))
        monitor = cam.PlantMotionMonitor()
        monitor.update(frame, plants, [], [])
        self.assertEqual(monitor.update(camera_moved, [(1, (105, 80, 245, 220))], [], []), set())

    def test_human_region_and_missing_texture_do_not_supply_movement_evidence(self):
        frame = np.zeros((300, 400, 3), dtype=np.uint8)
        monitor = cam.PlantMotionMonitor()
        plants = [(1, (100, 80, 240, 220))]
        monitor.update(frame, plants, [], [])
        self.assertEqual(monitor.update(frame, plants, [], []), set())
        rng = np.random.default_rng(7)
        frame = rng.integers(0, 256, frame.shape, dtype=np.uint8)
        moved = frame.copy()
        moved[80:220, 100:240] = np.roll(frame[80:220, 100:240], 5, axis=1)
        monitor = cam.PlantMotionMonitor()
        monitor.update(frame, plants, [(90, 70, 250, 230)], [])
        self.assertEqual(monitor.update(moved, plants, [(90, 70, 250, 230)], []), set())


if __name__ == '__main__':
    unittest.main()
