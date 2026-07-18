---
title: "KV cache"
date: "2025-01-03"
description: "KV cache 是 Transformer 标配的推理加速功能，只能用于 Decoder 架构的模型，由于其自回归的特性，推理时前面已经生成的字符不需要与后面的字符产生 attention（从而使得前面已经计算的 K 和 V 可以缓存起来…"
tags: ["LLM"]
---
参考链接：

[https://zhuanlan.zhihu.com/p/662498827](https://zhuanlan.zhihu.com/p/662498827)

[https://www.zte.com.cn/content/dam/zte-site/res-www-zte-com-cn/mediares/magazine/publication/com\_cn/article/202402/12.pdf](https://www.zte.com.cn/content/dam/zte-site/res-www-zte-com-cn/mediares/magazine/publication/com_cn/article/202402/12.pdf)

[https://mett29.github.io/posts/kv-cache/](https://mett29.github.io/posts/kv-cache/)

[https://r4j4n.github.io/blogs/posts/kv/](https://r4j4n.github.io/blogs/posts/kv/)

* * *

## 摘要

**KV cache** 是 Transformer 标配的推理加速功能，只能用于 Decoder 架构的模型，由于其自回归的特性，推理时前面已经生成的字符不需要与后面的字符产生 attention（从而使得前面已经计算的 K 和 V 可以缓存起来）；模型每次推理时只会预测输出一个 token，执行多次后完成全部输出，（由于模型的**自回归**性质，模型的输出也会作为后续生成的输入）而相邻前后两次输入只相差一个 token，这就导致出现了大量计算的重复（输入序列线性变换时）。而 KV cache 就是将每个 token 可复用的 $K$ 和 $V$ 向量结果保存下来复用，将计算复杂度从 $O(n^2)$降低为 $O(n)$。

## 为什么需要 KV cache

首先回顾下注意力计算的公式：

$$
\texttt{attention} = \texttt{softmax} (\frac{QK^T}{\sqrt{d_k}}) V
$$

假如我们有输入 $X = [x_1,…,x_n]$，当我们输入文本并期待模型输出时，比如输入 `I'm learning natural` ，模型开始预测并输出：

```plaintext
step 0 input: I'm learning natural
step 1 input: I'm learning natural language
step 2 input: I'm learning natural language processing
step 3 input: I'm learning natural language processing and
......
```

由于模型的 **自回归** 性质，模型先前的输出也会作为下一步预测的输入，模型在 step 1 预测出了 `language` 后，句子 `I'm learning natural language` 就会作为下一步的输入，在 step 2 时预测出 `processing` ，我们可以发现在模型不断接受输入的过程中，变化的只有先前输出的新词，前面的内容保持不变（这块的内容会随着输出过程而越来越多）。

回想 $Q, K, V$ 是如何产生的（$X$ 为输入序列）：

$$
Q = XW_Q \\K = XW_K \\V = XW_V
$$

根据我们上面的分析，输入序列 $X$ 会不断变长，而前面的内容其实是重复的，比如模型在连续两次进行预测输出时，输入的序列其实只相差在末尾的新生成的 token，前面的部分都是一样的，但是我们每次预测输出时都会进行如上述公式的计算，其中 $K = XW_K$ 就可以看成：

$$
K = \texttt{concat} (X_{previous},~ X_{last})W_K
$$

其中对于 $X_{previous}$ 的计算占了大部分，并且还都是重复的，所以很自然的想法就是把之前算的 $K$ 缓存起来，每次只计算当前词的 $K$，然后将其与之前缓存的 $K$ 拼接起来，得到的结果与上述经过重复计算的 $K$ 是一样的，并且还减少了大量的冗余计算，提高计算效率。

对 $V$ 的分析与 $K$ 类似，在此不再赘述，所以 KV Cache 解决的**计算瓶颈**是在于：

在输入序列 $X$ 经线性变换（也就是 $W_k$ 等矩阵）得到 $QKV$ 矩阵的过程中，减少了大量对于重复的输入部分进行线性变换的计算量。

-   无 KV cache 时：

每生成一个新词，都需要重新计算所有 $K$ 和 $V$，计算复杂度为 $O(n^2)$

-   使用 KV cache 时：

每生成一个新词，仅需计算最后一个生成的词的 $K_{last}$ 和 $V_{last}$，并将其与缓存拼接，计算复杂度降为 $O(n)$

## 如何进行 KV cache

在输入序列 $X$ 进行预测生成第一个词 $t_1$ 后，就缓存下第一块 $K_{cache}$ 和 $V_{cache}$，这一块是对输入序列 $X$ 的相关缓存；当生成第二个词时，只需要对最新生成的词 $t_1$ 计算其 $KV$ ：

$$
K_{last} = t_1W_K \\V_{last} = t_1W_V
$$

再将前面缓存的 $KV$ 进行拼接：

$$
K_{new} = \texttt{concat} (K_{cache},~ K_{last}) \\V_{new} = \texttt{concat} (V_{cache},~ V_{last})
$$

就得到了对输入序列 $X$ 与新词 $t_1$ 相关的 $KV$，然后更新其为新的缓存，作为下一步计算用到的缓存。

用代码表示为：  

```python
if layer_past is not None:
        past_key, past_value = layer_past
        # 进行拼接
        key = torch.cat((past_key, key), dim=-2)
        value = torch.cat((past_value, value), dim=-2)
    
    if use_cache is True:  # 当前是否需要缓存
        present = (key, value)
    else:
        present = None
    
    if self.reorder_and_upcast_attn:
        attn_output, attn_weights = self._upcast_and_reordered_attn(query, key, value, attention_mask, head_mask)
    else:
        attn_output, attn_weights = self._attn(query, key, value, attention_mask, head_mask)
```

([https://zhuanlan.zhihu.com/p/662498827](https://zhuanlan.zhihu.com/p/662498827))

## 为什么不需要 Q cache

在生成第 $t$ 个词的时候：

$$
Q_t = x_tW_Q
$$

即只需要考虑当前词生成的 $Q_t$ 向量并进行后续注意力计算，并不需要缓存前面的 $Q_{1…t-1}$，因为使用这些 $Q$ 向量与 $K^T$ 相乘得到的结果跟之前计算得到的结果是一样的，不需要这些重复的结果，所以每次对新的生成词产生的 $Q$ 向量都是不同的，因此不需要缓存

## KV Cache 自动实现因果注意力

由于缓存中的 K 和 V 只包含之前生成的词汇，当前生成的 Q 仅与这些缓存的 K 和 V 进行计算。这天然地实现了因果注意力（causal attention），即每个词只能关注其之前的词，而无法关注未来的词。所以当采用了 KV Cache 策略，并且在每次计算 Q、K、V 向量时仅处理当前生成的词汇时，通常**不需要**再考虑额外的注意力掩码（Attention Mask）
