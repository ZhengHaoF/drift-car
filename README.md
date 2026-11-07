# 漂移赛车（drift-car）

手机网页无尽漂移游戏：车头只有 45°/135° 两个朝向，点击切换，切换即漂移；冲出路面即坠落，距离即分数。

设计文档见 [docs/](docs/)：ADR 决策记录（0001~0011）、[词汇表](docs/glossary.md)、[设计决策树](docs/design-tree.md)。

## 开发

```bash
npm install
npm run dev
```

`npm run dev` 会输出局域网地址（如 `http://192.168.x.x:5173`），手机与电脑连同一 Wi-Fi 直接访问即可真机调试。

## 构建与部署

```bash
npm run build     # 产物在 dist/，相对路径 base，可部署任意静态托管
npm run preview   # 本地预览构建产物
```

## 调参

所有手感参数集中在 [src/config.ts](src/config.ts)（速度曲线、漂移角速度、路宽、段长、金币、相机、特效、音频）。

## 桌面调试

鼠标点击或空格键 = 切换方向，其余逻辑与手机一致。
