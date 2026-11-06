// Generated from Zeno contracts. Do not edit.
export default [
  {
    id: 'zeno_ListTasks',
    operation: 'ListTasks',
    method: 'GET',
    path: '/api/v1/tasks',
    parameters: {
      type: 'object',
      properties: {
        q: {
          maxLength: 200,
          type: 'string',
        },
        status: {
          maxLength: 40,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        due_bucket: {
          anyOf: [
            {
              const: 'overdue',
              type: 'string',
            },
            {
              const: 'today',
              type: 'string',
            },
            {
              const: 'future',
              type: 'string',
            },
            {
              const: 'none',
              type: 'string',
            },
          ],
        },
        limit: {
          pattern: '^[1-9]\\d{0,2}$',
          type: 'string',
        },
        offset: {
          pattern: '^\\d{1,9}$',
          type: 'string',
        },
        order_by: {
          const: 'due',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'q',
      'status',
      'priority',
      'category_id',
      'due_bucket',
      'limit',
      'offset',
      'order_by',
    ],
  },
  {
    id: 'zeno_GetTask',
    operation: 'GetTask',
    method: 'GET',
    path: '/api/v1/tasks/{id}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_CreateTask',
    operation: 'CreateTask',
    method: 'POST',
    path: '/api/v1/tasks',
    parameters: {
      type: 'object',
      properties: {
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        due_kind: {
          anyOf: [
            {
              const: 'none',
              type: 'string',
            },
            {
              const: 'date',
              type: 'string',
            },
            {
              const: 'instant',
              type: 'string',
            },
          ],
        },
        due_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        due_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        timezone: {
          minLength: 1,
          maxLength: 128,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'title',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateTask',
    operation: 'UpdateTask',
    method: 'PATCH',
    path: '/api/v1/tasks/{id}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        due_kind: {
          anyOf: [
            {
              const: 'none',
              type: 'string',
            },
            {
              const: 'date',
              type: 'string',
            },
            {
              const: 'instant',
              type: 'string',
            },
          ],
        },
        due_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        due_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        timezone: {
          minLength: 1,
          maxLength: 128,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_TransitionTask',
    operation: 'TransitionTask',
    method: 'POST',
    path: '/api/v1/tasks/{id}/transition',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        status: {
          anyOf: [
            {
              const: 'todo',
              type: 'string',
            },
            {
              const: 'in_progress',
              type: 'string',
            },
            {
              const: 'done',
              type: 'string',
            },
            {
              const: 'cancelled',
              type: 'string',
            },
          ],
        },
      },
      required: [
        'id',
        'status',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_ListEventSeries',
    operation: 'ListEventSeries',
    method: 'GET',
    path: '/api/v1/event-series',
    parameters: {
      type: 'object',
      properties: {
        q: {
          maxLength: 200,
          type: 'string',
        },
        status: {
          maxLength: 40,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        due_bucket: {
          anyOf: [
            {
              const: 'overdue',
              type: 'string',
            },
            {
              const: 'today',
              type: 'string',
            },
            {
              const: 'future',
              type: 'string',
            },
            {
              const: 'none',
              type: 'string',
            },
          ],
        },
        limit: {
          pattern: '^[1-9]\\d{0,2}$',
          type: 'string',
        },
        offset: {
          pattern: '^\\d{1,9}$',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'q',
      'status',
      'priority',
      'category_id',
      'due_bucket',
      'limit',
      'offset',
    ],
  },
  {
    id: 'zeno_GetEventSeries',
    operation: 'GetEventSeries',
    method: 'GET',
    path: '/api/v1/event-series/{id}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_CreateEventSeries',
    operation: 'CreateEventSeries',
    method: 'POST',
    path: '/api/v1/event-series',
    parameters: {
      type: 'object',
      properties: {
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        time_kind: {
          anyOf: [
            {
              const: 'range',
              type: 'string',
            },
            {
              const: 'start_only',
              type: 'string',
            },
            {
              const: 'all_day',
              type: 'string',
            },
          ],
        },
        start_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        end_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        start_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        end_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        timezone: {
          minLength: 1,
          maxLength: 128,
          type: 'string',
        },
        recurrence: {
          anyOf: [
            {
              const: 'none',
              type: 'string',
            },
            {
              const: 'daily',
              type: 'string',
            },
            {
              const: 'weekly',
              type: 'string',
            },
          ],
        },
        weekdays: {
          uniqueItems: true,
          maxItems: 7,
          type: 'array',
          items: {
            minimum: 1,
            maximum: 7,
            type: 'integer',
          },
        },
        until_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        recurrence_start_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        recurrence_time: {
          anyOf: [
            {
              pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'title',
        'time_kind',
        'timezone',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateEventSeries',
    operation: 'UpdateEventSeries',
    method: 'PATCH',
    path: '/api/v1/event-series/{id}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        time_kind: {
          anyOf: [
            {
              const: 'range',
              type: 'string',
            },
            {
              const: 'start_only',
              type: 'string',
            },
            {
              const: 'all_day',
              type: 'string',
            },
          ],
        },
        start_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        end_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        start_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        end_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        timezone: {
          minLength: 1,
          maxLength: 128,
          type: 'string',
        },
        recurrence: {
          anyOf: [
            {
              const: 'none',
              type: 'string',
            },
            {
              const: 'daily',
              type: 'string',
            },
            {
              const: 'weekly',
              type: 'string',
            },
          ],
        },
        weekdays: {
          uniqueItems: true,
          maxItems: 7,
          type: 'array',
          items: {
            minimum: 1,
            maximum: 7,
            type: 'integer',
          },
        },
        until_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        recurrence_start_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        recurrence_time: {
          anyOf: [
            {
              pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_CancelEventSeries',
    operation: 'CancelEventSeries',
    method: 'POST',
    path: '/api/v1/event-series/{id}/cancel',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_GetEventOccurrences',
    operation: 'GetEventOccurrences',
    method: 'GET',
    path: '/api/v1/event-occurrences',
    parameters: {
      type: 'object',
      properties: {
        from: {
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          type: 'string',
        },
        to: {
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          type: 'string',
        },
        timezone: {
          minLength: 1,
          maxLength: 128,
          type: 'string',
        },
        include_cancelled: {
          anyOf: [
            {
              const: 'true',
              type: 'string',
            },
            {
              const: 'false',
              type: 'string',
            },
          ],
        },
      },
      required: [
        'from',
        'to',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'from',
      'to',
      'timezone',
      'include_cancelled',
    ],
  },
  {
    id: 'zeno_UpdateEventOccurrence',
    operation: 'UpdateEventOccurrence',
    method: 'PATCH',
    path: '/api/v1/event-series/{id}/occurrences/{key}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        key: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        start_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        end_at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        start_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        end_date: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        cancelled: {
          type: 'boolean',
        },
      },
      required: [
        'id',
        'key',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
      'key',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_CancelEventOccurrence',
    operation: 'CancelEventOccurrence',
    method: 'POST',
    path: '/api/v1/event-series/{id}/occurrences/{key}/cancel',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        key: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
      },
      required: [
        'id',
        'key',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
      'key',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_ListCategories',
    operation: 'ListCategories',
    method: 'GET',
    path: '/api/v1/categories',
    parameters: {
      type: 'object',
      properties: {
        q: {
          maxLength: 200,
          type: 'string',
        },
        status: {
          maxLength: 40,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        due_bucket: {
          anyOf: [
            {
              const: 'overdue',
              type: 'string',
            },
            {
              const: 'today',
              type: 'string',
            },
            {
              const: 'future',
              type: 'string',
            },
            {
              const: 'none',
              type: 'string',
            },
          ],
        },
        limit: {
          pattern: '^[1-9]\\d{0,2}$',
          type: 'string',
        },
        offset: {
          pattern: '^\\d{1,9}$',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'q',
      'status',
      'priority',
      'category_id',
      'due_bucket',
      'limit',
      'offset',
    ],
  },
  {
    id: 'zeno_CreateCategory',
    operation: 'CreateCategory',
    method: 'POST',
    path: '/api/v1/categories',
    parameters: {
      type: 'object',
      properties: {
        name: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        sort_order: {
          minimum: 0,
          maximum: 9007199254740991,
          type: 'integer',
        },
      },
      required: [
        'name',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateCategory',
    operation: 'UpdateCategory',
    method: 'PATCH',
    path: '/api/v1/categories/{id}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        name: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        sort_order: {
          minimum: 0,
          maximum: 9007199254740991,
          type: 'integer',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_ListReminders',
    operation: 'ListReminders',
    method: 'GET',
    path: '/api/v1/reminders',
    parameters: {
      type: 'object',
      properties: {
        q: {
          maxLength: 200,
          type: 'string',
        },
        status: {
          maxLength: 40,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        due_bucket: {
          anyOf: [
            {
              const: 'overdue',
              type: 'string',
            },
            {
              const: 'today',
              type: 'string',
            },
            {
              const: 'future',
              type: 'string',
            },
            {
              const: 'none',
              type: 'string',
            },
          ],
        },
        limit: {
          pattern: '^[1-9]\\d{0,2}$',
          type: 'string',
        },
        offset: {
          pattern: '^\\d{1,9}$',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'q',
      'status',
      'priority',
      'category_id',
      'due_bucket',
      'limit',
      'offset',
    ],
  },
  {
    id: 'zeno_CreateReminder',
    operation: 'CreateReminder',
    method: 'POST',
    path: '/api/v1/reminders',
    parameters: {
      type: 'object',
      properties: {
        target_type: {
          anyOf: [
            {
              const: 'event',
              type: 'string',
            },
            {
              const: 'task',
              type: 'string',
            },
            {
              const: 'standalone',
              type: 'string',
            },
          ],
        },
        target_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        schedule_kind: {
          anyOf: [
            {
              const: 'absolute',
              type: 'string',
            },
            {
              const: 'before_start',
              type: 'string',
            },
          ],
        },
        at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        offset_minutes: {
          anyOf: [
            {
              minimum: 0,
              maximum: 5256000,
              type: 'integer',
            },
            {
              type: 'null',
            },
          ],
        },
        enabled: {
          type: 'boolean',
        },
        use_target_title: {
          type: 'boolean',
        },
      },
      required: [
        'target_type',
        'schedule_kind',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateReminder',
    operation: 'UpdateReminder',
    method: 'PATCH',
    path: '/api/v1/reminders/{id}',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        target_type: {
          anyOf: [
            {
              const: 'event',
              type: 'string',
            },
            {
              const: 'task',
              type: 'string',
            },
            {
              const: 'standalone',
              type: 'string',
            },
          ],
        },
        target_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        title: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        memo: {
          maxLength: 10000,
          type: 'string',
        },
        schedule_kind: {
          anyOf: [
            {
              const: 'absolute',
              type: 'string',
            },
            {
              const: 'before_start',
              type: 'string',
            },
          ],
        },
        at: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00)$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        offset_minutes: {
          anyOf: [
            {
              minimum: 0,
              maximum: 5256000,
              type: 'integer',
            },
            {
              type: 'null',
            },
          ],
        },
        enabled: {
          type: 'boolean',
        },
        use_target_title: {
          type: 'boolean',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_ListReminderOccurrences',
    operation: 'ListReminderOccurrences',
    method: 'GET',
    path: '/api/v1/reminder-occurrences',
    parameters: {
      type: 'object',
      properties: {
        q: {
          maxLength: 200,
          type: 'string',
        },
        status: {
          maxLength: 40,
          type: 'string',
        },
        priority: {
          anyOf: [
            {
              const: 'low',
              type: 'string',
            },
            {
              const: 'normal',
              type: 'string',
            },
            {
              const: 'high',
              type: 'string',
            },
          ],
        },
        category_id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        due_bucket: {
          anyOf: [
            {
              const: 'overdue',
              type: 'string',
            },
            {
              const: 'today',
              type: 'string',
            },
            {
              const: 'future',
              type: 'string',
            },
            {
              const: 'none',
              type: 'string',
            },
          ],
        },
        limit: {
          pattern: '^[1-9]\\d{0,2}$',
          type: 'string',
        },
        offset: {
          pattern: '^\\d{1,9}$',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'q',
      'status',
      'priority',
      'category_id',
      'due_bucket',
      'limit',
      'offset',
    ],
  },
  {
    id: 'zeno_GetDailyReviewSettings',
    operation: 'GetDailyReviewSettings',
    method: 'GET',
    path: '/api/v1/settings/daily-review',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateDailyReviewSettings',
    operation: 'UpdateDailyReviewSettings',
    method: 'PATCH',
    path: '/api/v1/settings/daily-review',
    parameters: {
      type: 'object',
      properties: {
        daily_review_local_time: {
          anyOf: [
            {
              pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        timezone: {
          minLength: 1,
          maxLength: 128,
          type: 'string',
        },
      },
      required: [
        'daily_review_local_time',
        'timezone',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_PreviewDailyReview',
    operation: 'PreviewDailyReview',
    method: 'GET',
    path: '/api/v1/daily-review',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_PreparePlanningChanges',
    operation: 'PreparePlanningChanges',
    method: 'POST',
    path: '/api/v1/planning/prepare',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          minItems: 1,
          maxItems: 100,
          type: 'array',
          items: {
            additionalProperties: false,
            type: 'object',
            required: [
              'operation',
              'input',
            ],
            properties: {
              operation: {
                anyOf: [
                  {
                    const: 'task.create',
                    type: 'string',
                  },
                  {
                    const: 'task.update',
                    type: 'string',
                  },
                  {
                    const: 'task.transition',
                    type: 'string',
                  },
                  {
                    const: 'event.create',
                    type: 'string',
                  },
                  {
                    const: 'event.update',
                    type: 'string',
                  },
                  {
                    const: 'event.cancel',
                    type: 'string',
                  },
                  {
                    const: 'exception.update',
                    type: 'string',
                  },
                  {
                    const: 'exception.cancel',
                    type: 'string',
                  },
                  {
                    const: 'category.create',
                    type: 'string',
                  },
                  {
                    const: 'category.update',
                    type: 'string',
                  },
                  {
                    const: 'reminder.create',
                    type: 'string',
                  },
                  {
                    const: 'reminder.update',
                    type: 'string',
                  },
                  {
                    const: 'review.update',
                    type: 'string',
                  },
                ],
              },
              id: {
                pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                type: 'string',
              },
              occurrence_key: {
                minLength: 1,
                maxLength: 200,
                type: 'string',
              },
              input: {
                type: 'object',
                patternProperties: {
                  '^(.*)$': {},
                },
              },
            },
          },
        },
      },
      required: [
        'changes',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
    confirmation: 'planning',
  },
  {
    id: 'zeno_GetFocusCurrent',
    operation: 'GetFocusCurrent',
    method: 'GET',
    path: '/api/v1/focus/current',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_StartFocus',
    operation: 'StartFocus',
    method: 'POST',
    path: '/api/v1/focus/start',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          anyOf: [
            {
              const: 'focus',
              type: 'string',
            },
            {
              const: 'break',
              type: 'string',
            },
          ],
        },
        minutes: {
          minimum: 1,
          maximum: 240,
          type: 'integer',
        },
        task_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        label: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        previous_session_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'kind',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_ExtendFocus',
    operation: 'ExtendFocus',
    method: 'POST',
    path: '/api/v1/focus/{id}/extend',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        minutes: {
          minimum: 1,
          maximum: 240,
          type: 'integer',
        },
      },
      required: [
        'id',
        'minutes',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_StopFocus',
    operation: 'StopFocus',
    method: 'POST',
    path: '/api/v1/focus/{id}/stop',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_PrepareFocusSwitch',
    operation: 'PrepareFocusSwitch',
    method: 'POST',
    path: '/api/v1/focus/switch/prepare',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          anyOf: [
            {
              const: 'focus',
              type: 'string',
            },
            {
              const: 'break',
              type: 'string',
            },
          ],
        },
        minutes: {
          minimum: 1,
          maximum: 240,
          type: 'integer',
        },
        task_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
        label: {
          minLength: 1,
          maxLength: 200,
          type: 'string',
        },
        previous_session_id: {
          anyOf: [
            {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'kind',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
    confirmation: 'focus',
  },
  {
    id: 'zeno_GetFocusHistory',
    operation: 'GetFocusHistory',
    method: 'GET',
    path: '/api/v1/focus/history',
    parameters: {
      type: 'object',
      properties: {
        cursor: {
          minLength: 1,
          maxLength: 500,
          type: 'string',
        },
        limit: {
          pattern: '^(?:[1-9]|[1-9][0-9]|100)$',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'cursor',
      'limit',
    ],
  },
  {
    id: 'zeno_UpdateFocusNote',
    operation: 'UpdateFocusNote',
    method: 'PATCH',
    path: '/api/v1/focus/{id}/note',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        note: {
          maxLength: 10000,
          type: 'string',
        },
      },
      required: [
        'id',
        'note',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_GetFocusDefaults',
    operation: 'GetFocusDefaults',
    method: 'GET',
    path: '/api/v1/settings/focus',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateFocusDefaults',
    operation: 'UpdateFocusDefaults',
    method: 'PATCH',
    path: '/api/v1/settings/focus',
    parameters: {
      type: 'object',
      properties: {
        focus_minutes: {
          minimum: 1,
          maximum: 240,
          type: 'integer',
        },
        break_minutes: {
          minimum: 1,
          maximum: 240,
          type: 'integer',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_ListNotifications',
    operation: 'ListNotifications',
    method: 'GET',
    path: '/api/v1/notifications',
    parameters: {
      type: 'object',
      properties: {
        ack_status: {
          anyOf: [
            {
              const: 'unread',
              type: 'string',
            },
            {
              const: 'acknowledged',
              type: 'string',
            },
            {
              const: 'cancelled',
              type: 'string',
            },
            {
              const: 'all',
              type: 'string',
            },
          ],
        },
        offset: {
          pattern: '^\\d{1,9}$',
          type: 'string',
        },
        limit: {
          pattern: '^(?:[1-9]|[1-9][0-9]|100)$',
          type: 'string',
        },
      },
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [
      'ack_status',
      'offset',
      'limit',
    ],
  },
  {
    id: 'zeno_AcknowledgeNotification',
    operation: 'AcknowledgeNotification',
    method: 'POST',
    path: '/api/v1/notifications/{id}/ack',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_SnoozeNotification',
    operation: 'SnoozeNotification',
    method: 'POST',
    path: '/api/v1/notifications/{id}/snooze',
    parameters: {
      type: 'object',
      properties: {
        id: {
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          type: 'string',
        },
        delay_minutes: {
          anyOf: [
            {
              const: 10,
              type: 'number',
            },
            {
              const: 30,
              type: 'number',
            },
          ],
        },
        at: {
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
          type: 'string',
        },
      },
      required: [
        'id',
      ],
      additionalProperties: false,
      anyOf: [
        {
          additionalProperties: false,
          type: 'object',
          required: [
            'id',
            'delay_minutes',
          ],
          properties: {
            id: {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            delay_minutes: {
              anyOf: [
                {
                  const: 10,
                  type: 'number',
                },
                {
                  const: 30,
                  type: 'number',
                },
              ],
            },
          },
        },
        {
          additionalProperties: false,
          type: 'object',
          required: [
            'id',
            'at',
          ],
          properties: {
            id: {
              pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
              type: 'string',
            },
            at: {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
              type: 'string',
            },
          },
        },
      ],
    },
    pathFields: [
      'id',
    ],
    queryFields: [],
  },
  {
    id: 'zeno_GetMeetingMute',
    operation: 'GetMeetingMute',
    method: 'GET',
    path: '/api/v1/settings/meeting-mute',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
  {
    id: 'zeno_UpdateMeetingMute',
    operation: 'UpdateMeetingMute',
    method: 'PATCH',
    path: '/api/v1/settings/meeting-mute',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
        },
        until: {
          anyOf: [
            {
              pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
        },
      },
      required: [
        'enabled',
        'until',
      ],
      additionalProperties: false,
    },
    pathFields: [],
    queryFields: [],
  },
]
