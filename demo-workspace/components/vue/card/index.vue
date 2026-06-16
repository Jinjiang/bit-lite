<template>
  <article class="vue-card">
    <h2>{{ title }}</h2>
    <p>{{ body }}</p>
    <button type="button" @click="count += 1">Clicked {{ count }} times</button>
  </article>
</template>

<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  title: string;
  body: string;
}>();

const count = ref(0);
</script>

<style scoped>
.vue-card {
  display: grid;
  gap: 10px;
  max-width: 420px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 18px;
}

.vue-card h2 {
  margin: 0;
  font-size: 20px;
}

.vue-card p {
  margin: 0;
  color: #4b5563;
}

.vue-card button {
  justify-self: start;
  border: 1px solid #2563eb;
  border-radius: 6px;
  background: #2563eb;
  color: white;
  cursor: pointer;
  font: inherit;
  padding: 9px 12px;
}
</style>
