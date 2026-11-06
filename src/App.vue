<script lang="ts">
export default {}
</script>

<style>
@import "../tokens.css";

page {
  min-height: 100%;
  background: var(--color-background);
  background: radial-gradient(ellipse at 50% 0%, var(--color-background-top), var(--color-background) 75%);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.5;
}
button { font: inherit; cursor: pointer; }
button::after { border: 0; }
button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 4px; }
button[disabled] { cursor: not-allowed; }

/* #ifdef H5 */
html, body { margin: 0; overflow-x: clip; }
/* 使用浏览器基础字号；不让 uni-app 的 rpx 根字号随视口拉大正文。 */
html { font-size: 100% !important; }
/* 禁用 uni-app 生产 H5 的第三方阴影图预加载。 */
body::after { animation: none !important; }
.uni-page-head-shadow::after { background-image: none !important; }
/* #endif */
</style>
