# Changelog

## [0.2.0](https://github.com/angelo-hub/orcaslicer/compare/mobile-v0.1.0...mobile-v0.2.0) (2026-10-18)


### Features

* **mobile:** anti-alias the 3D viewport with 4x MSAA ([f4b07b5](https://github.com/angelo-hub/orcaslicer/commit/f4b07b54c6a83ba5a43c3fc6e942770705c7eb43))
* **mobile:** desktop-style toolpath preview and a leaner Metal viewport ([37dad87](https://github.com/angelo-hub/orcaslicer/commit/37dad87bc55bb9882a1bec62c7393bcfdbbc542a))
* **mobile:** draw extrusions as beads at their real width in the preview ([d47f955](https://github.com/angelo-hub/orcaslicer/commit/d47f9552c6f01c2ecda9a10012524ac2d05a2ecd))
* **mobile:** show the OrcaSlicer version and commit the app is based on ([8275e1f](https://github.com/angelo-hub/orcaslicer/commit/8275e1f4dfc8c94a88967c3a1ab0a8b2dea409cf))


### Fixes

* **mobile:** depend on babel-preset-expo directly so a device build can bundle ([6236b23](https://github.com/angelo-hub/orcaslicer/commit/6236b239248640db04c3dc899949d08afbb19b32))
* **mobile:** depend on the Babel plugins NativeWind names so a device build can bundle ([ac9f6a1](https://github.com/angelo-hub/orcaslicer/commit/ac9f6a1fbeaa1cbcbcfbfc477bbec3a6b736751c))
* **mobile:** depend on the Babel plugins NativeWind names so a device build can bundle ([a63aef6](https://github.com/angelo-hub/orcaslicer/commit/a63aef633c3cc1696ab5a527d26a3f8a63b6c6e5))
* **mobile:** load config plugins through expo/config-plugins in a device build ([fb9b3a3](https://github.com/angelo-hub/orcaslicer/commit/fb9b3a35a066169f19d43c6a05045a82f1fd4288))
* **mobile:** pin the widget's bundle and app group identifiers ([1212cda](https://github.com/angelo-hub/orcaslicer/commit/1212cdac1c7837eeb935f1de3b5e7cc5a8e25f81))
* **mobile:** pin the widget's bundle and app group identifiers ([1cf09ca](https://github.com/angelo-hub/orcaslicer/commit/1cf09caa9e03afe3fdd41240c8320584b1e3a25b))
* **mobile:** refuse to register a runner Mac whose Xcode is older than 26 ([8ccf8fb](https://github.com/angelo-hub/orcaslicer/commit/8ccf8fb171aef6db6b312e1dc14effcbd3b0e850))


### Performance

* **mobile:** scrub the toolpath preview without rebuilding its buffer ([4df3d99](https://github.com/angelo-hub/orcaslicer/commit/4df3d99b88f9bf5a5744c7a8f4014c3b793da65a))
* **mobile:** store model meshes as positions only in the viewport ([821af7e](https://github.com/angelo-hub/orcaslicer/commit/821af7e6a3f097603baa69cca9c06e0b9e114ec1))

## [0.1.0](https://github.com/angelo-hub/orcaslicer/compare/mobile-v0.0.1...mobile-v0.1.0) (2026-10-18)


### Features

* **mobile:** preset transfer, Orca Cloud sync, guides and UI cleanup ([e112f85](https://github.com/angelo-hub/orcaslicer/commit/e112f85c14840da2a337ef0df24f4765e9629f02))
* **mobile:** preset transfer, Orca Cloud sync, in-app guides and a UI pass ([3464588](https://github.com/angelo-hub/orcaslicer/commit/34645885e92b5b9bf29bbd8680bcd6d6ae63ffc7))
