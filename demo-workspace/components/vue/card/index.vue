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
