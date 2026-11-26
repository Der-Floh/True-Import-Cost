import type { Directive } from 'vue';

export const vFocus: Directive<HTMLElement> = {
    mounted: element => element.focus(),
};
