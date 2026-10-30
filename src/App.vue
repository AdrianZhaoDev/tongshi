<script lang="ts">
export default {}
</script>

<style>
@import "../tokens.css";

page {
  background: var(--color-background);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.7;
}

/* #ifdef H5 */
html, body {
  margin: 0;
  overflow-x: clip;
}
/* #endif */
</style>
