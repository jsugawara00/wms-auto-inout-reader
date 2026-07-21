import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 親ディレクトリの lockfile を誤検出しないよう、このプロジェクトを root に固定
  turbopack: {
    root: __dirname,
  },
  // メール取込で使う Node 寄りのパッケージはバンドルせず実行時に require する
  // （Turbopack でのバンドルを避け、ビルド・起動を安定させる）
  serverExternalPackages: ["imapflow", "mailparser"],
  // 他サイトの iframe に埋め込まれて自サービスのように見せられるのを防ぐ。
  // frame-ancestors が本命で、X-Frame-Options は未対応ブラウザ向けの保険。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
