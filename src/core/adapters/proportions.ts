export function splitProportionally(total: number, weights: readonly number[]): number[] {
    const sum = weights.reduce((accumulated, weight) => accumulated + weight, 0);
    if (total <= 0 || weights.length === 0) {
        return weights.map(() => 0);
    }
    if (sum <= 0) {
        return weights.map(() => total / weights.length);
    }
    return weights.map(weight => (total * weight) / sum);
}
