/**
 * 中英混合分词器(纯 TS、零依赖)— 见 DESIGN.md §6.3。
 * 构建脚本(Node 原生 type-stripping)与客户端 useSearch 共享同一份源码,
 * 所以这里不能用 "@/" 路径别名,也不能依赖任何 npm 包。
 *
 * 规则:逐字符扫描 — CJK 连续段输出 bigram(单字则输出单字);
 * 拉丁/数字连续段小写化输出整词;其余字符视为分隔符。
 */

const CJK_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_RE = /[\p{L}\p{N}_]/u;

/** CJK 连续段 → bigram(单字则输出单字) */
function pushCjkBigrams(chars: string[], out: string[]): void {
  if (chars.length === 1) {
    out.push(chars[0]);
    return;
  }
  for (let i = 0; i < chars.length - 1; i += 1) {
    out.push(chars[i] + chars[i + 1]);
  }
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let cjkRun: string[] = [];
  let wordRun = "";

  const flushCjk = () => {
    if (cjkRun.length > 0) {
      pushCjkBigrams(cjkRun, tokens);
      cjkRun = [];
    }
  };
  const flushWord = () => {
    if (wordRun) {
      tokens.push(wordRun.toLowerCase());
      wordRun = "";
    }
  };

  // for...of 按码点迭代,代理对(生僻字/emoji)安全
  for (const char of text) {
    if (CJK_RE.test(char)) {
      flushWord();
      cjkRun.push(char);
    } else if (WORD_RE.test(char)) {
      flushCjk();
      wordRun += char;
    } else {
      flushCjk();
      flushWord();
    }
  }
  flushCjk();
  flushWord();

  return tokens;
}
