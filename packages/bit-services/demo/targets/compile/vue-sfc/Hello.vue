<template>
  <button class="hello" @click="count++">{{ label }}: {{ count }}</button>
</template>

<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  label: string;
}>();

const count = ref(0);
</script>

<style scoped>
.hello {
  color: #1f2937;
}
</style>
