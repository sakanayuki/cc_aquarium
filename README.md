# おさかな すいそう（cc_aquarium）

自分で描いた魚が水槽で泳ぐ、子供向けの Web アプリです。
仕様は [DESIGN.md](./DESIGN.md) を参照してください。

## あそびかた

- **おえかき画面**：魚の枠線（3種類から選択）を目安に、ペン・バケツ・消しゴムで自由に描きます。「できた！」を押すと、魚が袋に入って水槽に届きます。タップすると水槽へ放流されます。描いた絵全体がそのまま魚になります。
- **すいそう画面**：魚がゆっくり泳ぎます。「えさやり」で餌を撒くと、魚が寄ってきて食べます。
- **おさかな いちらん**：水槽画面のボタンから開きます。消したい魚を約1秒長押しすると消えます（消した直後だけ「もどす」で復旧できます）。
- 魚は端末の localStorage に保存されます（最大30匹）。最初はサンプル魚が2匹泳いでいます（同じく長押しで消せます）。

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # 型チェック + ビルド（dist/ に出力）
npm run preview  # ビルド結果のプレビュー
```

- Vite + React + TypeScript。公開パスは `/cc_aquarium/`（`vite.config.ts` の `base`）。
- `main` ブランチへ push すると GitHub Actions（`.github/workflows/deploy.yml`）がビルドして GitHub Pages へデプロイします。
- Pages の有効化（Settings → Pages → Build and deployment → Source: **GitHub Actions**）はリポジトリで1回だけ必要です。
