/** Port of `EmailSettingNames`: names of the settings defined by `EmailSettingProvider`. */
export const EmailSettingNames = {
  DefaultFromAddress: "Abp.Mailing.DefaultFromAddress",
  DefaultFromDisplayName: "Abp.Mailing.DefaultFromDisplayName",
  Smtp: {
    Host: "Abp.Mailing.Smtp.Host",
    Port: "Abp.Mailing.Smtp.Port",
    UserName: "Abp.Mailing.Smtp.UserName",
    Password: "Abp.Mailing.Smtp.Password",
    Domain: "Abp.Mailing.Smtp.Domain",
    EnableSsl: "Abp.Mailing.Smtp.EnableSsl",
    UseDefaultCredentials: "Abp.Mailing.Smtp.UseDefaultCredentials",
  },
} as const;
