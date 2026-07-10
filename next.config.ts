import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 親ディレクトリの lockfile を誤検出しないよう、このプロジェクトを root に固定
  turbopack: {
    root: __dirname,
  },
  // メール取込で使う Node 寄りのパッケージはバンドルせず実行時に require する
  // （Turbopack でのバンドルを避け、ビルド・起動を安定させる）
  serverExternalPackages: ["imapflow", "mailparser"],
};

export default nextConfig;
