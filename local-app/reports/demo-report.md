# Оценка проверки договоров

Режим: **demo**. Набор: test.

Демонстрационные метрики отражают только формализованные проверки. Они не доказывают качество LLM, юридическую корректность или полноту смыслового анализа. Эталоны синтетические, подготовлены разработчиком и требуют экспертной проверки.

Сопоставление: стабильный id типа отклонения (delivery/payment/advance/warranty/total/acceptance) и эталонная категория. Этот словарь задан в инструкции агента. Для произвольных новых видов отклонений требуется расширить разметку. Автоматическое сопоставление не заменяет экспертную сверку.

```json
{
  "mode": "demo",
  "model": "",
  "split": "test",
  "cases": 34,
  "precision": 1.0,
  "recall": 0.9167,
  "f1": 0.9565,
  "category_accuracy_on_matched": 1.0,
  "failed_cases": 3
}
```

## Три неудачных прогона

### hard-paraphrase

Ожидалось: {"delivery": "нарушение"}

Получено: {}

Причина: демонстрационный парсер распознаёт явно подписанные числовые поля; не выполняет полноценную проверку смысла и отсутствующих условий. См. пошаговый журнал ниже.

```json
[
  {
    "at": "2026-11-15T12:36:46.303017+00:00",
    "tool": "search_template",
    "arguments": {
      "query": "приемка поставка оплата"
    },
    "result": [
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p5",
        "text": "4. Срок оплаты: 30 календарных дней после приёмки.",
        "page": null,
        "score": 0.1369,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p6",
        "text": "5. Предоплата: 20% от стоимости договора.",
        "page": null,
        "score": 0.1211,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p10",
        "text": "9. Неустойка поставщика за просрочку: 0,1% в день, не более 10% стоимости недопоставленного товара.",
        "page": null,
        "score": 0.12,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p1",
        "text": "Учебная типовая форма договора поставки",
        "page": null,
        "score": 0.1081,
        "retrieval": "local_char_tfidf"
      }
    ],
    "elapsed_ms": 16,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.311998+00:00",
    "tool": "search_policy",
    "arguments": {
      "query": "срок поставки предоплата"
    },
    "result": [
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p3",
        "text": "1. Срок поставки: не более 30 календарных дней с даты подписания договора.",
        "page": null,
        "score": 0.2514,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p5",
        "text": "3. Предоплата: не более 20%. Превышение допускается только по согласованию с руководителем закупок.",
        "page": null,
        "score": 0.219,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p4",
        "text": "2. Срок оплаты: не более 30 календарных дней после приёмки.",
        "page": null,
        "score": 0.1826,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p9",
        "text": "7. Реквизиты поставщика сверяются с локальным справочником. Отсутствие записи требует проверки юриста, а не вывода о недобросовестности.",
        "page": null,
        "score": 0.0822,
        "retrieval": "local_char_tfidf"
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.316512+00:00",
    "tool": "check_numbers",
    "arguments": {},
    "result": [
      {
        "field": "delivery",
        "label": "Срок поставки",
        "status": "unresolved",
        "reason": "Нет однозначной пары значений",
        "observed": [],
        "limits": [
          {
            "value": "30",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p3",
              "quote": "1. Срок поставки: не более 30 календарных дней с даты подписания договора."
            }
          }
        ]
      },
      {
        "field": "payment",
        "label": "Срок оплаты",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "30",
            "source": {
              "document_id": "c8b259faa8da4ef3ab3ef4c11862f7b8",
              "clause_id": "p4",
              "quote": "3. Срок оплаты: 30 календарных дней после приёмки."
            }
          }
        ],
        "limits": [
          {
            "value": "30",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p4",
              "quote": "2. Срок оплаты: не более 30 календарных дней после приёмки."
            }
          }
        ]
      },
      {
        "field": "advance",
        "label": "Предоплата",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "20",
            "source": {
              "document_id": "c8b259faa8da4ef3ab3ef4c11862f7b8",
              "clause_id": "p5",
              "quote": "4. Предоплата: 20%."
            }
          }
        ],
        "limits": [
          {
            "value": "20",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p5",
              "quote": "3. Предоплата: не более 20%. Превышение допускается только по согласованию с руководителем закупок."
            }
          }
        ]
      },
      {
        "field": "warranty",
        "label": "Гарантия",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "12",
            "source": {
              "document_id": "c8b259faa8da4ef3ab3ef4c11862f7b8",
              "clause_id": "p6",
              "quote": "5. Гарантия: 12 месяцев со дня приёмки."
            }
          }
        ],
        "limits": [
          {
            "value": "12",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p6",
              "quote": "4. Гарантия: не менее 12 месяцев со дня приёмки."
            }
          }
        ]
      },
      {
        "field": "total",
        "label": "Сумма договора",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "400000",
            "source": {
              "document_id": "c8b259faa8da4ef3ab3ef4c11862f7b8",
              "clause_id": "p7",
              "quote": "6. Общая стоимость: 400000 руб."
            }
          }
        ],
        "limits": [
          {
            "value": "400000",
            "source": {
              "document_id": "4c8dc42d9cbe47838a2373ff404b7257",
              "clause_id": "p3",
              "quote": "Итого: 400000 руб."
            }
          }
        ]
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.321030+00:00",
    "tool": "lookup_supplier",
    "arguments": {},
    "result": {
      "status": "found",
      "inn": "7707083893",
      "source": {
        "document_id": "c8b259faa8da4ef3ab3ef4c11862f7b8",
        "clause_id": "p2",
        "quote": "1. Поставщик ООО «Учебный поставщик», ИНН: 7707083893."
      },
      "records": [
        {
          "document_id": "a031ff89e438408cba9383203aa1c1ae",
          "clause_id": "p2",
          "quote": "7707083893;ООО «Учебный поставщик»;770701001"
        }
      ]
    },
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.321030+00:00",
    "tool": "validate_findings",
    "arguments": {},
    "result": {
      "valid": true,
      "errors": [],
      "unreviewed_clause_ids": [
        "p1",
        "p2",
        "p3",
        "p4",
        "p5",
        "p6",
        "p7",
        "p8"
      ]
    },
    "elapsed_ms": 0,
    "tokens": 0
  }
]
```

### hard-missing-acceptance

Ожидалось: {"acceptance": "нарушение"}

Получено: {}

Причина: демонстрационный парсер распознаёт явно подписанные числовые поля; не выполняет полноценную проверку смысла и отсутствующих условий. См. пошаговый журнал ниже.

```json
[
  {
    "at": "2026-11-15T12:36:46.375078+00:00",
    "tool": "search_template",
    "arguments": {
      "query": "приемка поставка оплата"
    },
    "result": [
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p5",
        "text": "4. Срок оплаты: 30 календарных дней после приёмки.",
        "page": null,
        "score": 0.1369,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p6",
        "text": "5. Предоплата: 20% от стоимости договора.",
        "page": null,
        "score": 0.1211,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p10",
        "text": "9. Неустойка поставщика за просрочку: 0,1% в день, не более 10% стоимости недопоставленного товара.",
        "page": null,
        "score": 0.12,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p1",
        "text": "Учебная типовая форма договора поставки",
        "page": null,
        "score": 0.1081,
        "retrieval": "local_char_tfidf"
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.383010+00:00",
    "tool": "search_policy",
    "arguments": {
      "query": "срок поставки предоплата"
    },
    "result": [
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p3",
        "text": "1. Срок поставки: не более 30 календарных дней с даты подписания договора.",
        "page": null,
        "score": 0.2514,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p5",
        "text": "3. Предоплата: не более 20%. Превышение допускается только по согласованию с руководителем закупок.",
        "page": null,
        "score": 0.219,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p4",
        "text": "2. Срок оплаты: не более 30 календарных дней после приёмки.",
        "page": null,
        "score": 0.1826,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p9",
        "text": "7. Реквизиты поставщика сверяются с локальным справочником. Отсутствие записи требует проверки юриста, а не вывода о недобросовестности.",
        "page": null,
        "score": 0.0822,
        "retrieval": "local_char_tfidf"
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.383010+00:00",
    "tool": "check_numbers",
    "arguments": {},
    "result": [
      {
        "field": "delivery",
        "label": "Срок поставки",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "30",
            "source": {
              "document_id": "7db7068621d9440d8cf9929e73a57b3c",
              "clause_id": "p3",
              "quote": "2. Срок поставки: 30 календарных дней с даты подписания."
            }
          }
        ],
        "limits": [
          {
            "value": "30",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p3",
              "quote": "1. Срок поставки: не более 30 календарных дней с даты подписания договора."
            }
          }
        ]
      },
      {
        "field": "payment",
        "label": "Срок оплаты",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "30",
            "source": {
              "document_id": "7db7068621d9440d8cf9929e73a57b3c",
              "clause_id": "p4",
              "quote": "3. Срок оплаты: 30 календарных дней после приёмки."
            }
          }
        ],
        "limits": [
          {
            "value": "30",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p4",
              "quote": "2. Срок оплаты: не более 30 календарных дней после приёмки."
            }
          }
        ]
      },
      {
        "field": "advance",
        "label": "Предоплата",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "20",
            "source": {
              "document_id": "7db7068621d9440d8cf9929e73a57b3c",
              "clause_id": "p5",
              "quote": "4. Предоплата: 20%."
            }
          }
        ],
        "limits": [
          {
            "value": "20",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p5",
              "quote": "3. Предоплата: не более 20%. Превышение допускается только по согласованию с руководителем закупок."
            }
          }
        ]
      },
      {
        "field": "warranty",
        "label": "Гарантия",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "12",
            "source": {
              "document_id": "7db7068621d9440d8cf9929e73a57b3c",
              "clause_id": "p6",
              "quote": "5. Гарантия: 12 месяцев со дня приёмки."
            }
          }
        ],
        "limits": [
          {
            "value": "12",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p6",
              "quote": "4. Гарантия: не менее 12 месяцев со дня приёмки."
            }
          }
        ]
      },
      {
        "field": "total",
        "label": "Сумма договора",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "400000",
            "source": {
              "document_id": "7db7068621d9440d8cf9929e73a57b3c",
              "clause_id": "p7",
              "quote": "6. Общая стоимость: 400000 руб."
            }
          }
        ],
        "limits": [
          {
            "value": "400000",
            "source": {
              "document_id": "4c8dc42d9cbe47838a2373ff404b7257",
              "clause_id": "p3",
              "quote": "Итого: 400000 руб."
            }
          }
        ]
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.383010+00:00",
    "tool": "lookup_supplier",
    "arguments": {},
    "result": {
      "status": "found",
      "inn": "7707083893",
      "source": {
        "document_id": "7db7068621d9440d8cf9929e73a57b3c",
        "clause_id": "p2",
        "quote": "1. Поставщик ООО «Учебный поставщик», ИНН: 7707083893."
      },
      "records": [
        {
          "document_id": "a031ff89e438408cba9383203aa1c1ae",
          "clause_id": "p2",
          "quote": "7707083893;ООО «Учебный поставщик»;770701001"
        }
      ]
    },
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.401912+00:00",
    "tool": "validate_findings",
    "arguments": {},
    "result": {
      "valid": true,
      "errors": [],
      "unreviewed_clause_ids": [
        "p1",
        "p2",
        "p3",
        "p4",
        "p5",
        "p6",
        "p7",
        "p8"
      ]
    },
    "elapsed_ms": 0,
    "tokens": 0
  }
]
```

### hard-written-percent

Ожидалось: {"advance": "на согласование"}

Получено: {}

Причина: демонстрационный парсер распознаёт явно подписанные числовые поля; не выполняет полноценную проверку смысла и отсутствующих условий. См. пошаговый журнал ниже.

```json
[
  {
    "at": "2026-11-15T12:36:46.516436+00:00",
    "tool": "search_template",
    "arguments": {
      "query": "приемка поставка оплата"
    },
    "result": [
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p5",
        "text": "4. Срок оплаты: 30 календарных дней после приёмки.",
        "page": null,
        "score": 0.1369,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p6",
        "text": "5. Предоплата: 20% от стоимости договора.",
        "page": null,
        "score": 0.1211,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p10",
        "text": "9. Неустойка поставщика за просрочку: 0,1% в день, не более 10% стоимости недопоставленного товара.",
        "page": null,
        "score": 0.12,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "c90a2c3fe1a645eda6b65ba922ed145b",
        "id": "p1",
        "text": "Учебная типовая форма договора поставки",
        "page": null,
        "score": 0.1081,
        "retrieval": "local_char_tfidf"
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.516436+00:00",
    "tool": "search_policy",
    "arguments": {
      "query": "срок поставки предоплата"
    },
    "result": [
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p3",
        "text": "1. Срок поставки: не более 30 календарных дней с даты подписания договора.",
        "page": null,
        "score": 0.2514,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p5",
        "text": "3. Предоплата: не более 20%. Превышение допускается только по согласованию с руководителем закупок.",
        "page": null,
        "score": 0.219,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p4",
        "text": "2. Срок оплаты: не более 30 календарных дней после приёмки.",
        "page": null,
        "score": 0.1826,
        "retrieval": "local_char_tfidf"
      },
      {
        "document_id": "2b0c2a30295347dab47ec925f38ac481",
        "id": "p9",
        "text": "7. Реквизиты поставщика сверяются с локальным справочником. Отсутствие записи требует проверки юриста, а не вывода о недобросовестности.",
        "page": null,
        "score": 0.0822,
        "retrieval": "local_char_tfidf"
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.536246+00:00",
    "tool": "check_numbers",
    "arguments": {},
    "result": [
      {
        "field": "delivery",
        "label": "Срок поставки",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "30",
            "source": {
              "document_id": "7d38dce180ea4bdcb997862d68f56ab9",
              "clause_id": "p3",
              "quote": "2. Срок поставки: 30 календарных дней с даты подписания."
            }
          }
        ],
        "limits": [
          {
            "value": "30",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p3",
              "quote": "1. Срок поставки: не более 30 календарных дней с даты подписания договора."
            }
          }
        ]
      },
      {
        "field": "payment",
        "label": "Срок оплаты",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "30",
            "source": {
              "document_id": "7d38dce180ea4bdcb997862d68f56ab9",
              "clause_id": "p4",
              "quote": "3. Срок оплаты: 30 календарных дней после приёмки."
            }
          }
        ],
        "limits": [
          {
            "value": "30",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p4",
              "quote": "2. Срок оплаты: не более 30 календарных дней после приёмки."
            }
          }
        ]
      },
      {
        "field": "advance",
        "label": "Предоплата",
        "status": "unresolved",
        "reason": "Нет однозначной пары значений",
        "observed": [],
        "limits": [
          {
            "value": "20",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p5",
              "quote": "3. Предоплата: не более 20%. Превышение допускается только по согласованию с руководителем закупок."
            }
          }
        ]
      },
      {
        "field": "warranty",
        "label": "Гарантия",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "12",
            "source": {
              "document_id": "7d38dce180ea4bdcb997862d68f56ab9",
              "clause_id": "p6",
              "quote": "5. Гарантия: 12 месяцев со дня приёмки."
            }
          }
        ],
        "limits": [
          {
            "value": "12",
            "source": {
              "document_id": "2b0c2a30295347dab47ec925f38ac481",
              "clause_id": "p6",
              "quote": "4. Гарантия: не менее 12 месяцев со дня приёмки."
            }
          }
        ]
      },
      {
        "field": "total",
        "label": "Сумма договора",
        "status": "ok",
        "category": "нарушение",
        "observed": [
          {
            "value": "400000",
            "source": {
              "document_id": "7d38dce180ea4bdcb997862d68f56ab9",
              "clause_id": "p7",
              "quote": "6. Общая стоимость: 400000 руб."
            }
          }
        ],
        "limits": [
          {
            "value": "400000",
            "source": {
              "document_id": "4c8dc42d9cbe47838a2373ff404b7257",
              "clause_id": "p3",
              "quote": "Итого: 400000 руб."
            }
          }
        ]
      }
    ],
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.542389+00:00",
    "tool": "lookup_supplier",
    "arguments": {},
    "result": {
      "status": "found",
      "inn": "7707083893",
      "source": {
        "document_id": "7d38dce180ea4bdcb997862d68f56ab9",
        "clause_id": "p2",
        "quote": "1. Поставщик ООО «Учебный поставщик», ИНН: 7707083893."
      },
      "records": [
        {
          "document_id": "a031ff89e438408cba9383203aa1c1ae",
          "clause_id": "p2",
          "quote": "7707083893;ООО «Учебный поставщик»;770701001"
        }
      ]
    },
    "elapsed_ms": 0,
    "tokens": 0
  },
  {
    "at": "2026-11-15T12:36:46.548781+00:00",
    "tool": "validate_findings",
    "arguments": {},
    "result": {
      "valid": true,
      "errors": [],
      "unreviewed_clause_ids": [
        "p1",
        "p2",
        "p3",
        "p4",
        "p5",
        "p6",
        "p7",
        "p8"
      ]
    },
    "elapsed_ms": 0,
    "tokens": 0
  }
]
```
