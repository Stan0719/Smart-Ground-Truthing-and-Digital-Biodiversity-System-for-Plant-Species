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

    def test_camera_requires_wrist_contact_fixed_plant_and_live_mpu_movement(self):
        cases = [
            (True, 'moving', 1, True, True),
            (True, 'moving', 1, True, False),
            (True, 'stationary', 0, True, True),
            (True, 'unavailable', None, True, True),
            (True, 'stale', None, True, True),
            (False, 'moving', 1, True, True),
            (True, 'moving', 1, False, True),
            (True, 'moving', 1, False, False),
        ]
        for wrist_near, status, movement, fixed, detected in cases:
            with self.subTest(near=wrist_near, status=status, fixed=fixed, detected=detected):
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
                writer, sound, sensor = MagicMock(), MagicMock(), MagicMock()
                sensor.snapshot.return_value = {'status': status, 'movement': movement}
                with patch.multiple(cam.cv2, VideoCapture=MagicMock(return_value=capture),
                                    VideoWriter=MagicMock(return_value=writer), namedWindow=MagicMock(),
                                    setMouseCallback=MagicMock(), imshow=MagicMock(),
                                    destroyAllWindows=MagicMock(),
                                    waitKey=MagicMock(side_effect=[-1, -1, ord('q')])), \
                        patch.object(cam, 'YOLO', side_effect=[detector, pose_model]), \
                        patch.object(cam, 'YOLOWorld', return_value=plant_model), \
                        patch.object(cam, 'FixedPlantRegion', return_value=region), \
                        patch.object(cam.time, 'monotonic', side_effect=[0, 0, 1.9, 2]), \
                        patch.object(cam.camera_server, 'publish_frame') as publish_frame, \
                        patch.object(cam.camera_server, 'publish_event') as publish_event, \
                        patch.object(cam, 'put_text', wraps=cam.put_text) as text, \
                        patch.object(cam, 'winsound', sound):
                    cam._run_camera(web_enabled=True, sensor=sensor)
                should_alert = wrist_near and fixed and movement == 1 and status == 'moving'
                self.assertEqual(writer.write.call_count, 1 if should_alert else 0)
                self.assertEqual(sound.Beep.call_count, 1 if should_alert else 0)
                self.assertEqual(publish_frame.call_count, 3)
                self.assertEqual(publish_event.call_count, 1 if should_alert else 0)
                if should_alert:
                    self.assertEqual(publish_event.call_args.args[0], 'possible_plant_contact')
                    self.assertIn('MPU6050', publish_event.call_args.args[2])
                handling_labels = [call.args[1] for call in text.call_args_list
                                   if call.args[1].startswith('POSSIBLE HANDLING:')]
                self.assertEqual(bool(handling_labels), should_alert)
                capture.release.assert_called_once()

    def test_desktop_launch_does_not_require_a_plant_or_http_server(self):
        with patch.dict(cam.os.environ, {}, clear=True), \
                patch.object(cam.IoTMovementSource, 'from_environment') as source, \
                patch.object(cam.camera_server, 'start_server') as start, \
                patch.object(cam, '_run_camera') as run:
            cam.main()
        start.assert_not_called()
        run.assert_called_once_with(sensor=source.return_value)
        source.return_value.start.assert_not_called()

    def test_web_launch_closes_http_service_even_if_camera_initialization_fails(self):
        server = MagicMock()
        with patch.dict(cam.os.environ, {'CAMERA_ID': 'CAM-TEST', 'CAMERA_PLANT_ID': '42'}), \
                patch.object(cam.IoTMovementSource, 'from_environment') as source, \
                patch.object(cam.camera_server, 'start_server', return_value=server) as start, \
                patch.object(cam, '_run_camera', side_effect=RuntimeError('Camera failed')) as run:
            with self.assertRaisesRegex(RuntimeError, 'Camera failed'):
                cam.main()
        start.assert_called_once_with('CAM-TEST', '42')
        run.assert_called_once_with(web_enabled=True, sensor=source.return_value)
        source.return_value.close.assert_called_once_with()
        server.shutdown.assert_called_once_with()
        server.server_close.assert_called_once_with()



if __name__ == '__main__':
    unittest.main()
