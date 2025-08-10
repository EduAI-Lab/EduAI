import natural, { TfIdf } from "natural";
import * as math from "mathjs";

function createCombinedTerms(str1: string, str2: string): Set<string> {
  const terms = new Set<string>();
  str1.split(/\s+/).forEach((term) => terms.add(term));
  str2.split(/\s+/).forEach((term) => terms.add(term));
  return terms;
}

function getTfIdfVector(tfidf: natural.TfIdf, document: string, terms: Set<string>): number[] {
  const vector: number[] = [];
  terms.forEach((term) => {
    let termScore = 0;
    tfidf.tfidfs(term, (_index, measure) => {
      if (document.includes(term)) {
        termScore = measure as number;
      }
    });
    vector.push(termScore);
  });
  return vector;
}

function cosineSimilarityTFIDF(vecA: number[], vecB: number[]): number {
  const dotProduct = math.dot(vecA, vecB) as number;
  const magnitudeA: number = math.sqrt(math.dot(vecA, vecA) as number) as number;
  const magnitudeB: number = math.sqrt(math.dot(vecB, vecB) as number) as number;
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

export function TFIDF(str1: string, str2: string): number {
  const combinedTerms = createCombinedTerms(str1, str2);
  const tfidf = new TfIdf();
  tfidf.addDocument(str1);
  tfidf.addDocument(str2);
  const vec1 = getTfIdfVector(tfidf as any, str1, combinedTerms);
  const vec2 = getTfIdfVector(tfidf as any, str2, combinedTerms);
  return cosineSimilarityTFIDF(vec1, vec2);
}

function tokenize(str: string): string[] | null {
  return new natural.WordTokenizer().tokenize(str);
}

function createVector(tokens: string[], dict: string[]): number[] {
  const vec = new Array(dict.length).fill(0);
  tokens.forEach((token) => {
    const idx = dict.indexOf(token);
    if (idx >= 0) vec[idx]++;
  });
  return vec;
}

function dotProduct(vecA: number[], vecB: number[]): number {
  return vecA.reduce((acc, current, idx) => acc + current * vecB[idx], 0);
}

function magnitude(vec: number[]): number {
  return Math.sqrt(vec.reduce((acc, val) => acc + val * val, 0));
}

export function cosineSimilarity(strA: string, strB: string): number {
  const tokensA = tokenize(strA);
  const tokensB = tokenize(strB);
  if (!tokensA || !tokensB) return 0;
  const dict = Array.from(new Set([...tokensA, ...tokensB]));
  const vecA = createVector(tokensA, dict);
  const vecB = createVector(tokensB, dict);
  return dotProduct(vecA, vecB) / (magnitude(vecA) * magnitude(vecB));
}

export function similarities(source: string, target: string) {
  const jaroWinklerDistance = natural.JaroWinklerDistance(source, target, { ignoreCase: true });
  const levenshteinDistance = natural.LevenshteinDistance(source, target);
  const normalizedLevenshtein = 1 - levenshteinDistance / Math.max(source.length, target.length);
  const diceCoefficient = natural.DiceCoefficient(source, target);
  const TFDIF = TFIDF(source, target);
  return { jaroWinklerDistance, normalizedLevenshtein, diceCoefficient, TFDIF };
}



