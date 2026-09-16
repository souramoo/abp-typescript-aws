import { LocalizableString, Transient } from "@abp/core";
import { TemplateDefinition, TemplateDefinitionProvider, type ITemplateDefinitionContext } from "@abp/text-templating";
import { EmailingResource } from "../emailing-resource.js";

/** Port of `StandardEmailTemplates`. */
export const StandardEmailTemplates = {
  Layout: "Abp.StandardEmailTemplates.Layout",
  Message: "Abp.StandardEmailTemplates.Message",
} as const;

/** Port of `Volo/Abp/Emailing/Templates/Layout.tpl`. */
export const StandardEmailLayoutTemplate = `<!DOCTYPE html>
<html lang="{{abp_culture}}" dir="{{abp_dir}}" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8" />
</head>
<body>
    {{content}}
</body>
</html>`;

/** Port of `Volo/Abp/Emailing/Templates/Message.tpl`. */
export const StandardEmailMessageTemplate = "{{model.message}}";

/** Port of `StandardEmailTemplateDefinitionProvider` (contents are registered in memory by `AbpEmailingModule`). */
@Transient()
export class StandardEmailTemplateDefinitionProvider extends TemplateDefinitionProvider {
  define(context: ITemplateDefinitionContext): void {
    context.add(
      new TemplateDefinition(StandardEmailTemplates.Layout, {
        displayName: LocalizableString.create(EmailingResource, "TextTemplate:StandardEmailTemplates.Layout"),
        isLayout: true,
        isInlineLocalized: true,
      }),
      new TemplateDefinition(StandardEmailTemplates.Message, {
        displayName: LocalizableString.create(EmailingResource, "TextTemplate:StandardEmailTemplates.Message"),
        layout: StandardEmailTemplates.Layout,
        isInlineLocalized: true,
      }),
    );
  }
}
