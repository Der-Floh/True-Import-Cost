<script setup lang="ts">
defineProps<{ msg: string }>();
</script>

<template>
    <h1 class="hello">{{ msg }}</h1>
</template>

<style>
.hello {
    font-size: 2.4em;
    line-height: 1.1;
}
</style>
