# Оценка проверки договоров

Режим: **demo**. Набор: test.

Прерванные проверки не получают зачёт за частичный результат. Эталоны синтетические.

Числовой суффикс экземпляра (например advance-1) допускается. Сопоставление: стабильный id типа отклонения (delivery/payment/advance/warranty/total/acceptance) и эталонная категория. Этот словарь задан в инструкции агента. Для произвольных новых видов отклонений требуется расширить разметку. Автоматическое сопоставление не заменяет экспертную сверку.

```json
{
  "mode": "demo",
  "model": "",
  "split": "test",
  "cases": 34,
  "precision": 1.0,
  "recall": 0.9444,
  "f1": 0.9714,
  "category_accuracy_on_matched": 1.0,
  "failed_cases": 2,
  "interrupted_cases": 0
}
```

## Разбор ошибок (2 из 2)

### hard-missing-acceptance

Статус: completed

Ожидалось: {"acceptance": "нарушение"}
Зачтено: {}

Пропущены: acceptance

Вызовы: search_template → search_policy → check_numbers → lookup_supplier → validate_findings

### hard-written-percent

Статус: completed

Ожидалось: {"advance": "на согласование"}
Зачтено: {}

Пропущены: advance

Вызовы: search_template → search_policy → check_numbers → lookup_supplier → validate_findings
