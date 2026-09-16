/** Port of `AbpMongoDbConsts` plus the fixed attribute names of the single-table layout. */
export const AbpDynamoDbConsts = {
  ProviderName: "Volo.Abp.DynamoDB",
  /** Key segment used in place of a tenant id for host-side (or non multi-tenant) items. */
  HostScope: "host",
  PartitionKeyAttribute: "pk",
  SortKeyAttribute: "sk",
  EntityTypeAttribute: "entityType",
  /** Attribute holding the `path → runtime type` map that revives `Date`/`Map`/`Set` values on read. */
  TypesAttribute: "__types",
  /** Hard limits of the DynamoDB API. */
  TransactWriteItemsLimit: 100,
  BatchWriteItemsLimit: 25,
  OutboxEntityName: "OutgoingEventRecord",
  InboxEntityName: "IncomingEventRecord",
} as const;
